// The lock exists for one failure with no visible cause: a second supervisor ADOPTS the
// first's engine, and its shutdown does not spare an adopted engine — so quitting the second
// stops the first's engine, whose crash-watch restarts it two seconds later. What the user
// sees is an audio dropout that fixes itself.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hostlock-"));
  process.env.STUDIO_HOME = home;
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

const lock = () => import("./hostLock.ts");
const pidfile = () => join(home, "engine-host.pid");

describe("the supervisor lock", () => {
  it("is taken when nobody holds it, and names us", async () => {
    const { acquire } = await lock();
    expect(acquire()).toEqual({ ok: true });
    expect(readFileSync(pidfile(), "utf8").trim()).toBe(String(process.pid));
  });

  it("refuses a second supervisor and says which pid has it", async () => {
    // A real, live process that is not us: `kill 0` must actually find it.
    const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    try {
      writeFileSync(pidfile(), `${other.pid}\n`, "utf8");
      const { acquire } = await lock();
      expect(acquire()).toEqual({ ok: false, heldBy: other.pid });
    } finally {
      other.kill();
    }
  });

  it("takes over from a CRASHED supervisor rather than refusing forever", async () => {
    // A pid that is certainly dead: spawn one and wait for it to exit.
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((r) => dead.once("close", r));
    writeFileSync(pidfile(), `${dead.pid}\n`, "utf8");
    const { acquire } = await lock();
    expect(acquire()).toEqual({ ok: true });
  });

  it("survives a pidfile that is not a number", async () => {
    writeFileSync(pidfile(), "not a pid\n", "utf8");
    const { acquire } = await lock();
    expect(acquire()).toEqual({ ok: true });
  });

  it("releases only what is OURS — a later supervisor's file is not ours to delete", async () => {
    const { acquire, release } = await lock();
    acquire();
    expect(existsSync(pidfile())).toBe(true);
    release();
    expect(existsSync(pidfile())).toBe(false);

    // Someone else's now: releasing must leave it alone.
    writeFileSync(pidfile(), "999999\n", "utf8");
    release();
    expect(existsSync(pidfile())).toBe(true);
  });
});
