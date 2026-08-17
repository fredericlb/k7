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

/**
 * Something that already KNOWS the module folders have not moved — a process watching them.
 *
 * A single bit, and deliberately not a token: this file must hand back the stamp the walk would
 * have produced, or the memo below would miss and re-read the whole médiathèque every time the
 * answer changed hands. `false` means "walk", which is what everything that installs nothing
 * gets — the CLI, the tests, a script. That is what keeps a watcher, and the state and the
 * platform quirks that come with one, out of this library. See docs/moduleCache.md.
 */
export type FoldersStill = (dir: string) => boolean;
let still: FoldersStill | null = null;

/** Install it, or `null` to go back to walking. The file service is the only caller. */
export function setFoldersStill(f: FoldersStill | null): void {
  still = f;
}

/** The last stamp walked per project, so a watcher's "nothing moved" can hand it back verbatim. */
const walked = new Map<string, string>();

/**
 * The stamp, walked unless something is watching and says nothing has moved.
 *
 * The oracle is asked only when there IS a previous stamp to hand back: the first read of a
 * project always walks, whatever anyone claims, which is what makes an empty watcher safe.
 */
function stampFor(dir: string): string {
  const held = walked.get(dir);
  if (held !== undefined && still?.(dir)) return held;
  const fresh = moduleStamp(dir);
  walked.set(dir, fresh);
  if (walked.size > MAX_ENTRIES)
    walked.delete(walked.keys().next().value as string);
  return fresh;
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
  // Already inside one for this project: keep it, so the stamp stays paid once. Opening a fresh
  // scope here threw the enclosing one's stamp away and walked again — which is how HOISTING a
  // scope over two calls that each open their own (a compile and a graph build) made things
  // slower rather than faster, measured at +19 ms a level. Re-entrant exactly as `withRevision`
  // is in the file service, and for the same reason.
  if (scope?.dir === dir) return fn();
  const outer = scope;
  scope = { dir };
  try {
    return fn();
  } finally {
    // Restored rather than cleared: a scope for ANOTHER folder may enclose this one — the graph
    // of a library chain built while a project is open — and the two stamps are not the same.
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
    scope.stamp ??= stampFor(dir); // lazily, so a scope that reads nothing walks nothing
    stamp = scope.stamp;
  } else {
    stamp = stampFor(dir);
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
