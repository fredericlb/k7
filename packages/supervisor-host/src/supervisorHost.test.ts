// supervisorHost.test.ts — SupervisorHost against a fake supervisor: a node script speaking the same NDJSON.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "./hostProtocol.ts";
import { SupervisorHost } from "./supervisorHost.ts";

// Emits one snapshot, answers `crash` by dying, `shutdown` by leaving and `closein` by shutting its stdin while staying up, and otherwise ends with its stdin.
const FAKE = `#!/usr/bin/env node
const rl = require("node:readline").createInterface({ input: process.stdin });
const out = (f) => process.stdout.write(JSON.stringify(f) + "\\n");
let deaf = false;
out({ t: "state", status: "running", ownsEngine: true, userStopped: false, engineId: "e1", enginePort: 8765, registryUrl: "", hostPid: process.env.STUDIO_HOST_PID });
rl.on("line", (l) => {
  const c = JSON.parse(l);
  if (c.cmd === "crash") process.exit(3);
  if (c.cmd === "notify") out({ t: "notify", kind: "passive", title: "hi", body: c.arg });
  if (c.cmd === "shutdown") process.exit(0);
  if (c.cmd === "closein") {
    deaf = true;
    setInterval(() => {}, 1000);
    process.stdin.destroy();
    try { require("node:fs").closeSync(0); } catch {}
    out({ t: "notify", kind: "passive", title: "closed", body: "stdin closed" });
  }
});
rl.on("close", () => { if (!deaf) process.exit(0); });
`;

const dirs: string[] = [];
const hosts: SupervisorHost[] = [];

function fakeBin(): string {
  const dir = mkdtempSync(join(tmpdir(), "supervisor-host-"));
  dirs.push(dir);
  const bin = join(dir, "fake-supervisor");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  return bin;
}

// Generous: a spawned node under a full test run can take seconds to start, and slowness is not the failure tested here.
function until<T>(read: () => T | undefined, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const v = read();
      if (v !== undefined) resolve(v);
      else if (Date.now() > deadline) reject(new Error("timed out"));
      else setTimeout(tick, 20);
    };
    tick();
  });
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop(500)));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
  "SupervisorHost",
  { timeout: 20_000 },
  () => {
    it("hands snapshots and notifications up, and tells the supervisor who its host is", async () => {
      const snaps: Snapshot[] = [];
      const notes: string[] = [];
      const host = new SupervisorHost({
        bin: fakeBin(),
        onSnapshot: (s) => snaps.push(s),
        onNotify: (n) => notes.push(n.body),
      });
      hosts.push(host);
      host.start();
      const first = await until(() => snaps[0]);
      expect(first.status).toBe("running");
      expect((first as Snapshot & { hostPid?: string }).hostPid).toBe(
        String(process.pid),
      );
      host.send("notify", "there");
      expect(await until(() => notes[0])).toBe("there");
    });

    it("relaunches a supervisor that died, and not one it stopped", async () => {
      let launches = 0;
      const downs: (string | null)[] = [];
      const host = new SupervisorHost({
        bin: fakeBin(),
        onSnapshot: () => launches++,
        onDown: (why) => downs.push(why),
        backoff: { first: 50, max: 200, resetAfter: 10_000 },
      });
      hosts.push(host);
      host.start();
      await until(() => (launches >= 1 ? true : undefined));
      host.send("crash");
      await until(() => (launches >= 2 ? true : undefined));
      expect(downs).toContain("supervisor restarting…");
      await host.stop(500);
      await new Promise((r) => setTimeout(r, 300));
      expect(launches).toBe(2);
    });

    it("survives writing to a supervisor whose stdin is gone", async () => {
      const lines: string[] = [];
      const notes: string[] = [];
      let snaps = 0;
      const host = new SupervisorHost({
        bin: fakeBin(),
        onSnapshot: () => snaps++,
        onNotify: (n) => notes.push(n.body),
        log: (l) => lines.push(l),
      });
      hosts.push(host);
      host.start();
      await until(() => (snaps >= 1 ? true : undefined));
      host.send("closein");
      // Told, not slept for: the writes below must meet a CLOSED stdin, however long the fake takes to close it.
      await until(() => notes.find((n) => n === "stdin closed"));
      for (let i = 0; i < 20; i++) host.send("notify", "x".repeat(65_536));
      await until(() => lines.find((l) => l.startsWith("supervisor stdin:")));
    });
  },
);
