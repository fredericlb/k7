// hostLock.ts — one supervisor per machine, held in ~/.studio/engine-host.pid. Two would
// each ADOPT the one engine (ownsEngine:false), and shutdown deliberately does not spare an
// adopted engine — so quitting the second would stop the first's engine, whose crash-watch
// then restarts it 2s later. The only symptom is an unexplained audio dropout with a
// self-healing icon. Taken by startSupervisor, so it guards both front ends.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostPidPath, studioDir } from "@studio/engine-client/paths";

/** Alive? `kill 0` asks without signalling, and answers for a process we did not spawn. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists and belongs to someone else — still a supervisor in our way.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Who holds the lock, or null. A stale file is REMOVED, since a crash never gets to. */
export function heldBy(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(hostPidPath(), "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) {
      return pid;
    }
    rmSync(hostPidPath(), { force: true });
  } catch {}
  return null;
}

/**
 * Take the lock, or answer who has it. `wx` is the atomic part: two supervisors racing cannot
 * both win, whichever order they arrive in.
 */
export function acquire(): { ok: true } | { ok: false; heldBy: number } {
  const existing = heldBy();
  if (existing !== null) return { ok: false, heldBy: existing };
  mkdirSync(studioDir(), { recursive: true });
  try {
    closeSync(openSync(hostPidPath(), "wx"));
  } catch {
    // Lost the race between heldBy() and here, or the file reappeared.
    const now = heldBy();
    if (now !== null) return { ok: false, heldBy: now };
  }
  writeFileSync(hostPidPath(), `${process.pid}\n`, "utf8");
  return { ok: true };
}

/** Release, but only if it is still OURS — a later supervisor's file is not ours to delete. */
export function release(): void {
  try {
    const pid = Number.parseInt(readFileSync(hostPidPath(), "utf8").trim(), 10);
    if (pid === process.pid) rmSync(hostPidPath(), { force: true });
  } catch {}
}
