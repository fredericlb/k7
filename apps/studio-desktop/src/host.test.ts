// The relaunch loop against a real child process, because the parts that matter here are all
// timing: a dev reload must NOT pay the crash backoff, a crash must, and an unreadable frame
// must not take the channel down. The fake supervisor is `node -e`, so this runs anywhere.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLink } from "./host.ts";
import type { HostCmd } from "./hostCmd.ts";

let home: string;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "capot-host-run-"));
  process.env.STUDIO_HOME = home;
});

afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

// Every fake exits on stdin EOF, exactly as the real supervisor does (ipcStdio's `listen`
// calls onEnd from readline's "close"). Without it a fake looks like a HUNG supervisor and
// every teardown would pay the full kill grace — which is a different test, below.
const EXIT_ON_EOF = `require("readline").createInterface({input:process.stdin}).on("close",()=>process.exit(0));`;

/** A supervisor that runs `script`, then idles until its stdin closes. */
const fake = (script: string): HostCmd => ({
  program: process.execPath,
  args: ["-e", `${EXIT_ON_EOF}${script}`],
});

/** One that ignores stdin entirely — the hung supervisor the kill path exists for. */
const deaf = (script: string): HostCmd => ({
  program: process.execPath,
  args: ["-e", script],
});

function collector() {
  const snapshots: HostSnapshot[] = [];
  const errors: (string | null)[] = [];
  return {
    snapshots,
    errors,
    handlers: {
      onSnapshot: (s: HostSnapshot) => snapshots.push(s),
      onNotify: () => {},
      onHostError: (m: string | null) => errors.push(m),
    },
  };
}

const until = async (p: () => boolean, ms = 4000): Promise<void> => {
  const stop = Date.now() + ms;
  while (!p()) {
    if (Date.now() > stop) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("the supervisor link", () => {
  it("delivers a state frame as a snapshot", async () => {
    const c = collector();
    const link = new HostLink(
      c.handlers,
      fake(
        `process.stdout.write(JSON.stringify({t:"state",status:"running",enginePort:8765,engineId:"abcdef012345"})+"\\n");setTimeout(()=>{},1e4)`,
      ),
    );
    link.start();
    await until(() => c.snapshots.length > 0);
    expect(c.snapshots[0]?.status).toBe("running");
    expect(c.snapshots[0]?.enginePort).toBe(8765);
    await link.shutdownAndWait();
  });

  it("survives an unreadable frame and keeps reading the next one", async () => {
    const c = collector();
    const link = new HostLink(
      c.handlers,
      fake(
        `process.stdout.write("{not json\\n");process.stdout.write(JSON.stringify({t:"state",status:"stopped"})+"\\n");setTimeout(()=>{},1e4)`,
      ),
    );
    link.start();
    await until(() => c.snapshots.length > 0);
    expect(c.snapshots[0]?.status).toBe("stopped");
    await link.shutdownAndWait();
  });

  it("relaunches a dev reload (exit 77) at once, without the crash backoff", async () => {
    const c = collector();
    // Exits 77 forever; two launches inside a second is only possible with no backoff paid.
    const link = new HostLink(
      c.handlers,
      fake(
        `process.stdout.write(JSON.stringify({t:"state",status:"stopped"})+"\\n");process.exit(77)`,
      ),
    );
    const started = Date.now();
    link.start();
    await until(() => c.snapshots.length >= 3, 3000);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(c.errors).toContain("supervisor reloading…");
    expect(c.errors).not.toContain("supervisor restarting…");
    await link.shutdownAndWait();
  });

  it("pays the backoff for a crash, and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = collector();
    const link = new HostLink(c.handlers, fake(`process.exit(1)`));
    link.start();
    await until(() => c.errors.includes("supervisor restarting…"), 3000);
    expect(c.errors).not.toContain("supervisor reloading…");
    await link.shutdownAndWait();
    vi.useRealTimers();
  });

  it("reports 'supervisor not found' once and does not retry", async () => {
    const c = collector();
    const link = new HostLink(c.handlers, null);
    link.start();
    await until(() => c.errors.length > 0);
    expect(c.errors).toEqual(["supervisor not found"]);
  });

  it("sends NDJSON commands with an incrementing id", async () => {
    const c = collector();
    // Echo each command back as a notify-shaped state so the test can read what arrived.
    const link = new HostLink(
      c.handlers,
      deaf(
        `process.stdin.on("end",()=>process.exit(0));` +
          `let b="";process.stdin.on("data",d=>{b+=d;for(const l of b.split("\\n").slice(0,-1)){` +
          `const m=JSON.parse(l);process.stdout.write(JSON.stringify({t:"state",status:"stopped",error:l})+"\\n")}` +
          `b=b.slice(b.lastIndexOf("\\n")+1)});setTimeout(()=>{},1e4)`,
      ),
    );
    link.start();
    await new Promise((r) => setTimeout(r, 300));
    link.send("engine.start");
    link.send("audio.select", "Scarlett");
    await until(() => c.snapshots.length >= 2, 3000);
    expect(JSON.parse(c.snapshots[0]?.error ?? "{}")).toEqual({
      t: "cmd",
      id: 1,
      cmd: "engine.start",
    });
    expect(JSON.parse(c.snapshots[1]?.error ?? "{}")).toEqual({
      t: "cmd",
      id: 2,
      cmd: "audio.select",
      arg: "Scarlett",
    });
    await link.shutdownAndWait();
  });

  it("kills a supervisor that ignores shutdown, rather than holding the app open", async () => {
    const c = collector();
    // Ignores stdin close and never exits on its own.
    const link = new HostLink(
      c.handlers,
      deaf(`process.stdin.resume();setInterval(()=>{},1000)`),
    );
    link.start();
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    await link.shutdownAndWait();
    // Bounded by the 3s grace, not open-ended.
    expect(Date.now() - started).toBeLessThan(4500);
  }, 10000);
});
