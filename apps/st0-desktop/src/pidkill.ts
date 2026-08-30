// pidkill.ts — the last-resort cleanup on quit, for the case where the supervisor never got
// there (hung, or already crashed). An engine that survives the app holds the audio device
// and both ports — and the NEXT launch adopts a process nobody is supervising. The pidfile is
// the contract both sides already agree on (engineDaemon.ts). See docs/lifetime.md.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { enginePidPath } from "@studio/engine-client/paths";

/**
 * Kill a process and its descendants, the same two mechanisms the supervisor uses
 * (processTree.ts): Windows has no signals, so `taskkill /T /F` walks the parent links; Unix
 * signals the process GROUP, which every engine leads (spawned detached), so negating the pid
 * reaches everything it forked.
 *
 * Shelling out rather than walking the process table is deliberate: this runs once, at quit,
 * and correctness here is about REACH, not about avoiding a spawn.
 */
export function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
    return;
  }
  try {
    // A negative pid is the group; ESRCH just means it was already gone.
    process.kill(-pid, "SIGTERM");
  } catch {}
}

/** What the pidfile names, read while it still exists. See `backstop` for why that matters. */
export function enginePid(): number | null {
  let text: string;
  try {
    text = readFileSync(enginePidPath(), "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Kill the engine if the teardown did not; `pid` is taken BEFORE it runs — see docs/lifetime.md. */
export function backstop(pid?: number | null): boolean {
  const target = pid ?? enginePid();
  rmSync(enginePidPath(), { force: true });
  if (!target) return false;
  try {
    // Asks without signalling; EPERM means it exists and is somebody else's.
    process.kill(target, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  killTree(target);
  return true;
}
