// moduleCache.ts — the module vocabulary is the expensive half of every compile and the half
// that changes least, so it is memoised per project against a STAMP of the folders it is read
// from: every entry's name, plus the newest mtime among the files that define a module. A 20 ms
// directory walk in place of a 295 ms read of the whole médiathèque. See docs/moduleCache.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXTS_PATH } from "./engineCatalogue";
import { modulePanelRoots } from "./sharedFolders";

/** A file whose CONTENT says what a module is. Everything else is named in the stamp, not stat'd. */
const DEFINITION = /\.(ya?ml|ts|vstpreset)$/i;

/** `<type>/<category>/<module>/assets/<sub>` is the deepest real tree; also a floor under a link loop. */
const MAX_DEPTH = 6;

/** How many projects' vocabularies to hold. Each is a few MB, and one service drives a handful. */
const MAX_ENTRIES = 4;

/**
 * A token that changes when anything the module loaders read changes.
 *
 * The roots are the ones they actually walk — the project's own `modules/`, the shared libraries,
 * its flat `nodes/` — plus the engine's scan cache, which is a module source with no folder.
 * Names go into a hash rather than a count so a RENAME shows up: renaming a file keeps its mtime
 * and the count, and a stamp that missed it would serve a module under a name nobody wrote.
 */
function moduleStamp(dir: string): string {
  let hash = 2166136261; // FNV-1a over every entry name — cheap, and no syscall of its own
  let entries = 0;
  let newest = 0;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  const stamp = (path: string): void => {
    try {
      const m = statSync(path).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* raced away between readdir and stat — the next call sees it */
    }
  };
  const walk = (abs: string, depth: number): void => {
    let found: Dirent[];
    try {
      found = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // not there, or unreadable — the loaders treat it as empty too
    }
    for (const e of found) {
      if (e.name.startsWith(".")) continue;
      entries++;
      mix(e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(join(abs, e.name), depth + 1);
        continue;
      }
      if (DEFINITION.test(e.name)) stamp(join(abs, e.name));
    }
  };
  for (const root of modulePanelRoots(dir)) walk(root, 0);
  walk(join(dir, "nodes"), 0);
  // A rescan rewrites this and touches no library — `@engine/…` refs come out of it.
  stamp(EXTS_PATH);
  return `${(hash >>> 0).toString(36)}:${entries}:${newest}`;
}

/** One project's cached reads, all invalidated together by the one stamp they were built under. */
interface Slot {
  stamp: string;
  values: Map<string, unknown>;
}
const memo = new Map<string, Slot>();

/** The stamp the enclosing `withModuleStamp` already paid for, computed on the first ask. */
let scope: { dir: string; stamp?: string } | null = null;

/**
 * Run `fn` with ONE stamp walk for `dir`, however many cached reads it makes.
 *
 * A compile asks twice — `loadModules` then `loadModuleRefs` — and each ask re-walked the module
 * folders: 328 readdirs and 418 stats, 28 ms of a 144 ms compile, spent proving nothing had
 * changed since the previous line. Measured on a real song (15 tracks, 57 clips, 31 plugins):
 * the second walk is 19% of `compileNodeProject` and of `loadGraph` alike.
 *
 * Scoped EXPLICITLY rather than by tick or by clock, because a stale stamp serves a module under
 * a name nobody wrote: only a caller that reads and never writes may say it. The compile entry
 * points are those callers; anything outside a scope still stamps per read, as before.
 */
export function withModuleStamp<T>(dir: string, fn: () => T): T {
  const outer = scope;
  scope = { dir };
  try {
    return fn();
  } finally {
    scope = outer;
  }
}

/**
 * `build()`'s result for `dir`, kept until the module folders change.
 *
 * `key` names WHICH read — the loaders cache two — so one stamp walk covers both. Insertion
 * order is the LRU: a slot is re-inserted on every hit, and the oldest goes when there are
 * too many.
 */
export function cachedForModules<T>(
  dir: string,
  key: string,
  build: () => T,
): T {
  let stamp: string;
  if (scope?.dir === dir) {
    scope.stamp ??= moduleStamp(dir); // lazily, so a scope that reads nothing walks nothing
    stamp = scope.stamp;
  } else {
    stamp = moduleStamp(dir);
  }
  let slot = memo.get(dir);
  if (slot && slot.stamp !== stamp) slot = undefined; // changed on disk — drop the whole slot
  memo.delete(dir);
  if (!slot) slot = { stamp, values: new Map() };
  memo.set(dir, slot);
  for (const oldest of memo.keys()) {
    if (memo.size <= MAX_ENTRIES) break;
    memo.delete(oldest);
  }
  if (!slot.values.has(key)) slot.values.set(key, build());
  return slot.values.get(key) as T;
}
