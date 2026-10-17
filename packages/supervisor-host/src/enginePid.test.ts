// enginePid.test.ts — the pidfile read as an identity, and a teardown that kills only what it proved is the engine.

import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  linkSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPid,
  inspectPid,
  isEngineExecutable,
  lstartSeconds,
  parsePidFile,
  pidAlive,
} from "./enginePid.ts";
import { SupervisorHost } from "./supervisorHost.ts";

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "engine-pid-"));
  dirs.push(dir);
  return dir;
}

describe("parsePidFile", () => {
  it("reads a bare pid as unverified", () => {
    expect(parsePidFile("4242\n")).toEqual({ pid: 4242 });
  });
  it("reads the extended format the supervisor writes", () => {
    expect(
      parsePidFile("123\nstart=1760000000\nexe=/opt/k7/k7-runtime\n"),
    ).toEqual({ pid: 123, start: "1760000000", exe: "/opt/k7/k7-runtime" });
  });
  it("refuses what is not a pid", () => {
    expect(parsePidFile("")).toBeNull();
    expect(parsePidFile("abc")).toBeNull();
    expect(parsePidFile("-5")).toBeNull();
    expect(parsePidFile("0")).toBeNull();
  });
});

describe("checkPid", () => {
  const engine = { pid: 10, start: "500", exe: "/x/k7-runtime" };
  it("is `same` only for the engine's executable at the recorded start", () => {
    expect(checkPid(engine, engine, true)).toBe("same");
    expect(checkPid(engine, { ...engine, start: "501" }, true)).toBe("stale");
    expect(checkPid(engine, { ...engine, exe: "/usr/bin/vim" }, true)).toBe(
      "stale",
    );
    expect(checkPid(engine, null, false)).toBe("stale");
    expect(checkPid(engine, null, true)).toBe("unverified");
    expect(checkPid({ pid: 10 }, engine, true)).toBe("unverified");
  });
  it("knows the engine by its name", () => {
    expect(isEngineExecutable("C:\\k7\\K7-Runtime.exe")).toBe(true);
    expect(isEngineExecutable("/usr/bin/k7-runtime-helper")).toBe(false);
  });
  it("reads ps's lstart as local seconds", () => {
    const at = new Date(2026, 9, 16, 10, 0, 5);
    expect(lstartSeconds("Fri Oct 16 10:00:05 2026")).toBe(
      String(at.getTime() / 1000),
    );
    expect(lstartSeconds("garbage")).toBeUndefined();
  });
});

// A spawned process under a full test run can take seconds to show up: slowness is not what these test.
describe.skipIf(process.platform === "win32")(
  "the teardown backstop",
  { timeout: 20_000 },
  () => {
    function sleeper(bin = "/bin/sleep", args = ["30"]): ChildProcess {
      const child = spawn(bin, args, { detached: true, stdio: "ignore" });
      children.push(child);
      return child;
    }

    async function stopWith(pidFileText: string): Promise<void> {
      const file = join(tempDir(), "engine.pid");
      writeFileSync(file, pidFileText);
      const host = new SupervisorHost({
        bin: "/nonexistent",
        enginePidFile: file,
        log: () => {},
      });
      await host.stop(100);
    }

    it("describes a live process the same way twice", () => {
      const a = inspectPid(process.pid);
      expect(a?.start).toBeTruthy();
      expect(a?.exe).toBeTruthy();
      expect(inspectPid(process.pid)?.start).toBe(a?.start);
    });

    it("never kills a bare pid, which may by now be anything", async () => {
      const child = sleeper();
      await stopWith(`${child.pid}\n`);
      expect(pidAlive(child.pid ?? 0)).toBe(true);
    });

    it("never kills a pid whose identity does not match", async () => {
      const child = sleeper();
      await stopWith(`${child.pid}\nstart=1\nexe=/x/k7-runtime\n`);
      expect(pidAlive(child.pid ?? 0)).toBe(true);
    });

    it("kills the engine the pidfile proves", async () => {
      const bin = join(tempDir(), "k7-runtime");
      // Node under the engine's name: Alpine's /bin/sleep is BusyBox, which refuses to run as "k7-runtime".
      try {
        linkSync(process.execPath, bin);
      } catch {
        copyFileSync(process.execPath, bin);
      }
      const child = sleeper(bin, ["-e", "setTimeout(() => {}, 30000)"]);
      const pid = child.pid ?? 0;
      const exited = new Promise((r) => child.once("exit", r));
      const live = await waitFor(() => {
        const r = inspectPid(pid);
        return r && isEngineExecutable(r.exe ?? "") ? r : null;
      });
      await stopWith(`${pid}\nstart=${live.start}\nexe=${live.exe}\n`);
      await exited;
      expect(pidAlive(pid)).toBe(false);
    });
  },
);

async function waitFor<T>(read: () => T | null): Promise<T> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const v = read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
}
