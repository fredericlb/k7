// staleCaches.ts — purging what the accounts' caches hold that nobody used for a month: automatic
// VST renders (`<account>/.renders`) and undo journals (`<account>/.history`). The hub runs it, not
// the file services: an account's service is stopped when idle, which is exactly when its caches go
// stale. "Used" is the later of atime and mtime, since the compile marks a render on its atime alone.
// See packages/song/docs/autoFreeze.md and packages/file-service/docs/history.md.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_RENDERS_HOME_DIR,
  HISTORY_HOME_DIR,
} from "@studio/song-schema/moduleTypes";

/** What nobody used for this long is deleted; a render is made again, a journal starts empty. */
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

/** How often the hub sweeps: an hour late on a one-month rule is nothing. */
export const CACHE_SWEEP_EVERY_MS = 3600 * 1000;

const listOrEmpty = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** When `path` was last used, or null when it is gone. */
const lastUsed = (path: string): number | null => {
  try {
    const st = statSync(path);
    return Math.max(st.atimeMs, st.mtimeMs);
  } catch {
    return null;
  }
};

const remove = (path: string): boolean => {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false; // busy: the next sweep tries again
  }
};

/** Delete every account's render unused for `ttl`; answers how many went. Never throws. */
export function purgeStaleRenders(
  dataRoot: string,
  now = Date.now(),
  ttl = CACHE_TTL_MS,
): number {
  let removed = 0;
  for (const account of listOrEmpty(dataRoot)) {
    const cache = join(dataRoot, account, AUTO_RENDERS_HOME_DIR);
    for (const name of listOrEmpty(cache)) {
      const at = lastUsed(join(cache, name));
      if (at !== null && now - at >= ttl && remove(join(cache, name)))
        removed++;
    }
  }
  return removed;
}

/** Delete every project journal unused for `ttl`, and any older blob of a live one; answers how many went. */
export function purgeStaleHistory(
  dataRoot: string,
  now = Date.now(),
  ttl = CACHE_TTL_MS,
): number {
  let removed = 0;
  for (const account of listOrEmpty(dataRoot)) {
    const home = join(dataRoot, account, HISTORY_HOME_DIR);
    for (const project of listOrEmpty(home)) {
      const dir = join(home, project);
      // A journal is used by every edit, undo and redo, which rewrite it.
      const at = lastUsed(join(dir, "journal.json")) ?? lastUsed(dir);
      if (at !== null && now - at >= ttl) {
        if (remove(dir)) removed++;
        continue;
      }
      // A blob older than the rule is gone everywhere else too: an engine purges its own copy alike.
      for (const blob of listOrEmpty(join(dir, "blobs"))) {
        const file = join(dir, "blobs", blob);
        const t = lastUsed(file);
        if (t !== null && now - t >= ttl && remove(file)) removed++;
      }
    }
  }
  return removed;
}
