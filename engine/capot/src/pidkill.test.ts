// The backstop's whole job is REACH: an engine spawned detached leads its own group, so
// killing the pid alone would leave whatever it forked holding the ports. Unix only —
// on Windows the same reach comes from `taskkill /T`, which has no local equivalent to assert.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backstop, killTree } from "./pidkill.ts";

let home: string;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "capot-pid-"));
  process.env.STUDIO_HOME = home;
});

afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = async (p: () => boolean, ms = 3000): Promise<void> => {
  const stop = Date.now() + ms;
  while (!p()) {
    if (Date.now() > stop) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.skipIf(process.platform === "win32")("the quit backstop", () => {
  it("reaches a detached leader's whole group, not just the pid it was given", async () => {
    // A leader that forks a child, exactly as the engine daemon does; the child's pid comes
    // back on stdout so the test can watch it independently.
    const leader = spawn(
      process.execPath,
      [
        "-e",
        `const {spawn}=require("child_process");` +
          `const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});` +
          `process.stdout.write(String(c.pid));setInterval(()=>{},1000)`,
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const childPid = await new Promise<number>((r) =>
      leader.stdout?.once("data", (d: Buffer) => r(Number(d.toString()))),
    );
    expect(alive(childPid)).toBe(true);

    killTree(leader.pid ?? 0);

    await until(() => !alive(childPid));
    expect(alive(childPid)).toBe(false);
  });

  it("removes the pidfile so a fresh supervisor does not adopt a dead engine", () => {
    const pidfile = join(home, "engine.pid");
    // A pid that is certainly gone: our own group would be wrong to signal.
    writeFileSync(pidfile, "2147483careful", "utf8");
    backstop();
    expect(existsSync(pidfile)).toBe(false);
  });

  it("is a no-op when there is no pidfile — the normal case", () => {
    expect(() => backstop()).not.toThrow();
  });
});
