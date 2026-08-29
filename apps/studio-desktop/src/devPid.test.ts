// Under WSL this tree is MIRRORED to the host, so a dev pidfile can arrive from the other
// machine — where that number names an unrelated process. stopAll would then kill it. The
// platform stamp is what prevents that, and this is the test for it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { DEV_PID, running } from "../scripts/trayProcess.mjs";

const pidfile = DEV_PID as string;
const list = running as () => { pid: number; path: string }[];

let saved: string | null = null;

beforeEach(() => {
  try {
    saved = readFileSync(pidfile, "utf8");
  } catch {
    saved = null;
  }
  mkdirSync(dirname(pidfile), { recursive: true });
});

afterEach(() => {
  if (saved === null) rmSync(pidfile, { force: true });
  else writeFileSync(pidfile, saved, "utf8");
});

const write = (pid: number, platform: string) =>
  writeFileSync(pidfile, `${JSON.stringify({ pid, platform })}\n`, "utf8");

describe("the dev pidfile", () => {
  it("finds a live app on THIS platform", () => {
    write(process.pid, process.platform);
    expect(list().some((p) => p.pid === process.pid)).toBe(true);
  });

  it("ignores one written on another platform, whatever the pid says", () => {
    // Our own pid, so "alive" is certainly true — only the platform can reject it.
    const other = process.platform === "win32" ? "linux" : "win32";
    write(process.pid, other);
    expect(list().some((p) => p.pid === process.pid)).toBe(false);
  });

  it("ignores a pid that is gone, and removes the file", () => {
    // 2^22 is above every default pid_max, so it cannot name a live process.
    write(4194304, process.platform);
    expect(list().some((p) => p.pid === 4194304)).toBe(false);
  });

  it("survives a pidfile that is not JSON at all", () => {
    writeFileSync(pidfile, "12345\n", "utf8");
    expect(() => list()).not.toThrow();
  });
});
