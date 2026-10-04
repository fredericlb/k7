// renderCache.ts — purging the accounts' automatic VST renders (`<account>/.renders`) that nobody
// played for 48 h. The hub runs it, not the file services: an account's service is stopped when
// idle, which is exactly when its renders go stale. "Used" is the later of atime and mtime, since
// the compile marks a render on its atime alone. See packages/song/docs/autoFreeze.md.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTO_RENDERS_HOME_DIR } from "@studio/song-schema/moduleTypes";

/** A render nobody used for this long is deleted; the next compile that wants it renders it again. */
export const RENDER_TTL_MS = 48 * 3600 * 1000;

/** How often the hub sweeps: an hour late on a 48-hour rule is nothing. */
export const RENDER_SWEEP_EVERY_MS = 3600 * 1000;

const listOrEmpty = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Delete every account's render unused for `ttl`; answers how many went. Never throws. */
export function purgeStaleRenders(
  dataRoot: string,
  now = Date.now(),
  ttl = RENDER_TTL_MS,
): number {
  let removed = 0;
  for (const account of listOrEmpty(dataRoot)) {
    const cache = join(dataRoot, account, AUTO_RENDERS_HOME_DIR);
    for (const name of listOrEmpty(cache)) {
      const file = join(cache, name);
      try {
        const st = statSync(file);
        if (now - Math.max(st.atimeMs, st.mtimeMs) < ttl) continue;
        rmSync(file, { recursive: true, force: true });
        removed++;
      } catch {
        // Gone already, or busy: the next sweep tries again.
      }
    }
  }
  return removed;
}
