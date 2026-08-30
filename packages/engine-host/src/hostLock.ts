// hostLock.ts — one supervisor per machine, held in ~/.studio/engine-host.pid. Two would
// each ADOPT the one engine (ownsEngine:false), and shutdown deliberately does not spare an
// adopted engine — so quitting the second would stop the first's engine, whose crash-watch
// then restarts it 2s later. The only symptom is an unexplained audio dropout with a
// self-healing icon. Taken by startSupervisor, so it guards both front ends.
//
// The holder KEEPS SAYING SO, and a lock nobody has refreshed goes stale: a pid is not an
// identity, and a dead one gets reused. See docs/supervisorPolicy.md.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostPidPath, studioDir } from "@studio/engine-client/paths";

/** How often the holder refreshes the lock, and how long an unrefreshed one is believed. */
const TOUCH_MS = 2_000;
const STALE_MS = 15_000;

/** The refresh, running while we hold it. Unref'd: it must not hold a CLI open by itself. */
let beat: NodeJS.Timeout | null = null;

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

/** Who holds it, or null. Stale = the pid is gone OR nobody refreshed it — docs/supervisorPolicy.md. */
export function heldBy(): number | null {
  try {
    const path = hostPidPath();
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    const age = Date.now() - statSync(path).mtimeMs;
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      pid !== process.pid &&
      alive(pid) &&
      age < STALE_MS
    ) {
      return pid;
    }
    rmSync(path, { force: true });
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
  keepSaying();
  return { ok: true };
}

/** Rewrite our pid on a timer: the mtime is the claim, and the content re-states whose it is. */
function keepSaying(): void {
  if (beat) return;
  beat = setInterval(() => {
    try {
      // Read before writing: a lock naming somebody else was taken from us, and that is said.
      const held = Number.parseInt(
        readFileSync(hostPidPath(), "utf8").trim(),
        10,
      );
      if (held !== process.pid) {
        process.stderr.write(
          `[host] the supervisor lock was taken by pid ${held} — two supervisors are running\n`,
        );
        return;
      }
      writeFileSync(hostPidPath(), `${process.pid}\n`, "utf8");
    } catch {
      // Gone under us: the next acquire re-creates it, and refusing to write is not fatal.
    }
  }, TOUCH_MS);
  beat.unref();
}

/** Release, but only if it is still OURS — a later supervisor's file is not ours to delete. */
export function release(): void {
  if (beat) {
    clearInterval(beat);
    beat = null;
  }
  try {
    const pid = Number.parseInt(readFileSync(hostPidPath(), "utf8").trim(), 10);
    if (pid === process.pid) rmSync(hostPidPath(), { force: true });
  } catch {}
}
