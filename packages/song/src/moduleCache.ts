// moduleCache.ts — the module vocabulary is the expensive half of every compile and the half
// that changes least, so it is memoised per project against a STAMP of the folders it is read
// from: every entry's name, plus the newest mtime among the files that define a module. A 20 ms
// directory walk in place of a 295 ms read of the whole médiathèque. See docs/moduleCache.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXTS_PATH } from "./engineCatalogue";
import { modelsRoot } from "./modelCache";
import { modulePanelRoots } from "./sharedFolders";

/** A file whose CONTENT says what a module is. Everything else is named in the stamp, not stat'd. */
const DEFINITION = /\.(ya?ml|ts|js|vstpreset)$/i;

/** `<type>/<category>/<module>/assets/<sub>` is the deepest real tree; also a floor under a link loop. */
const MAX_DEPTH = 6;

/** How many projects' vocabularies to hold. Each is a few MB, and one service drives a handful. */
const MAX_ENTRIES = 4;

/** A token that changes when anything the loaders read does; NAMES are hashed, so a rename shows up. */
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
  // …and a model landing in the machine's cache changes what a module's `onnx:` resolves to, in no
  // module folder: the folder's own mtime moves when one is renamed into it (docs/moduleAssets.md).
  stamp(modelsRoot());
  return `${(hash >>> 0).toString(36)}:${entries}:${newest}`;
}

/** Something that already KNOWS the folders have not moved — one BIT, never a token, docs/moduleCache.md. */
export type FoldersStill = (dir: string) => boolean;
let still: FoldersStill | null = null;

/** Install it, or `null` to go back to walking. The file service is the only caller. */
export function setFoldersStill(f: FoldersStill | null): void {
  still = f;
}

/** The last stamp walked per project, so a watcher's "nothing moved" can hand it back verbatim. */
const walked = new Map<string, string>();

/** The stamp, walked unless a watcher says nothing moved AND there is one to hand back. */
function stampFor(dir: string): string {
  const held = walked.get(dir);
  if (held !== undefined && still?.(dir)) return held;
  const fresh = moduleStamp(dir);
  walked.set(dir, fresh);
  if (walked.size > MAX_ENTRIES)
    walked.delete(walked.keys().next().value as string);
  return fresh;
}

/**
 * How old a file's mtime must be before it can be trusted as a cache key, anywhere in this repo.
 * A write landing in the same file-time tick as the read before it REPRODUCES the stamp, so what
 * was cached under it then serves the edit that has just been made. The window is wider than any
 * clock or filesystem granularity (NTFS sub-ms, FAT 2 s, network mounts 1 s), and what it buys is
 * measured in docs/moduleCache.md. `yamlCache` and the file service's text image key on it too.
 */
export const SETTLE_MS = 2_000;

/** The newest mtime out of a stamp this file made — `<hash>:<entries>:<mtime>`. */
const newestOf = (stamp: string): number =>
  Number(stamp.slice(stamp.lastIndexOf(":") + 1)) || 0;

/** One project's cached reads, all invalidated together by the one stamp they were built under. */
interface Slot {
  stamp: string;
  values: Map<string, unknown>;
}
const memo = new Map<string, Slot>();

/**
 * The stamp the enclosing `withModuleStamp` already paid for, computed on the first ask — plus
 * what was built under it while it was too young to keep. Those values are consistent with each
 * other and die with the derivation, which is the whole of what makes them safe.
 */
let scope: {
  dir: string;
  stamp?: string;
  young?: Map<string, unknown>;
} | null = null;

/** Run `fn` with ONE stamp walk for `dir`, scoped EXPLICITLY — see docs/moduleCache.md. */
export function withModuleStamp<T>(dir: string, fn: () => T): T {
  // Already inside one for this project: keep it, so the stamp stays paid once (docs/moduleCache.md).
  if (scope?.dir === dir) return fn();
  const outer = scope;
  scope = { dir };
  try {
    return fn();
  } finally {
    // Restored rather than cleared: a scope for ANOTHER folder may enclose this one.
    scope = outer;
  }
}

/** `build()`'s result for `dir`, kept until the module folders change — see docs/moduleCache.md. */
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
  // Too young to key on: nothing built now may outlive the caller that asked for it, since the
  // next write can still land under this same stamp. Inside a scope it is held for that scope.
  if (Date.now() - newestOf(stamp) <= SETTLE_MS) {
    memo.delete(dir); // and a slot already under it could have been built before that write
    if (scope?.dir !== dir) return build();
    const young = (scope.young ??= new Map());
    if (!young.has(key)) young.set(key, build());
    return young.get(key) as T;
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
