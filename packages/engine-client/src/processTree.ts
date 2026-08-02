// processTree.ts — kill a child AND everything it spawned. A plain child.kill() reaches
// only the process we hold, which leaves the file service's grandchild holding port 8770
// and a scan's leftovers holding the audio device. Both platforms need their own
// mechanism, and neither is optional. Full rationale: docs/processTree.md.

import { spawnSync } from "node:child_process";

/**
 * Kill `pid` and its descendants.
 *
 * Windows has no signals and no process groups: `taskkill /T` walks the parent links
 * itself, `/F` forces it.
 *
 * Unix gets the same reach from the process GROUP, which is why every child here is
 * spawned `detached: true` — that makes the child a group leader, so negating its pid
 * signals the whole group. Falls back to the bare pid if the group is already gone.
 */
export function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM"); // the group: the child and everything it forked
  } catch {
    try {
      process.kill(pid, "SIGTERM"); // not a group leader after all
    } catch {
      /* already gone */
    }
  }
}
