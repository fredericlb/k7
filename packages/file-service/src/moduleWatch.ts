// moduleWatch.ts — watch a project's module folders so `@studio/song`'s stamp walk becomes
// rare instead of per-read. A root inside the live capture's workspace is heard through its
// change feed; any other gets one recursive `fs.watch`. A generation counter, and a ceiling that
// walks anyway now and then so a missed event heals itself. Full rationale: docs/moduleWatch.md.

import { type FSWatcher, watch } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { setFoldersStill } from "@studio/song/moduleCache";
import { modulePanelRoots } from "@studio/song/sharedFolders";
import {
  CHAINS_DIR,
  TRACKS_DIR,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import type { ChangeFeed } from "./liveCapture.ts";

/** A ceiling, not a cache interval: it makes a MISSED event a delay — see docs/moduleWatch.md. */
export const WALK_ANYWAY_MS = 10_000;

/** The roots a project's module vocabulary is read from — the same list the stamp walks. */
const rootsOf = (dir: string): string[] => [
  ...modulePanelRoots(dir),
  join(dir, "nodes"),
  // A chain project's nodes, lanes and plugin states; `layout.yaml` feeds no cached read (docs/moduleWatch.md).
  ...[CHAINS_DIR, TRACKS_DIR, VSTPRESETS_DIR].map((d) => join(dir, d)),
];

interface Watch {
  handles: FSWatcher[];
  /** The feed the covered roots are heard through, and how to stop hearing it. */
  feed: ChangeFeed | null;
  unsubscribe: (() => void) | null;
  /** Bumped by every event on every root. Only its CHANGES matter, never its value. */
  gen: number;
  /** The generation the last walk saw, and when that walk was. */
  seen: number;
  at: number;
}

const watches = new Map<string, Watch>();

/** `abs` as a slash-separated path under `root`, "" for the root itself, or null when outside it. */
function inside(root: string, abs: string): string | null {
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** Does a reported path touch `root` — the root itself, under it, or a folder holding it that moved whole. */
const touches = (root: string, rel: string): boolean =>
  !root ||
  rel === root ||
  rel.startsWith(`${root}/`) ||
  root.startsWith(`${rel}/`);

/** Watch `dir`'s module folders, idempotently per feed; why not chokidar is in docs/moduleWatch.md. */
export function watchModuleFolders(
  dir: string,
  feed: ChangeFeed | null = null,
): void {
  const had = watches.get(dir);
  if (had && had.feed === feed) return;
  // The workspace's capture was replaced: hear the new one rather than a stopped one.
  if (had) closeModuleWatch(dir);
  const w: Watch = {
    handles: [],
    feed,
    unsubscribe: null,
    gen: 0,
    seen: 0,
    at: 0,
  };
  const heard: string[] = [];
  for (const root of rootsOf(dir)) {
    const rel = feed ? inside(feed.root, root) : null;
    if (rel !== null) {
      heard.push(rel);
      continue;
    }
    try {
      const h = watch(root, { recursive: true, persistent: false }, () => {
        w.gen++;
      });
      // Losing the watch is itself a change, so it counts as one rather than taking the process down.
      h.on("error", () => {
        w.gen++;
      });
      w.handles.push(h);
    } catch {
      // Not there, or recursive watching unsupported: uncovered, and the ceiling keeps that honest.
    }
  }
  if (feed && heard.length)
    w.unsubscribe = feed.onChange((rel) => {
      if (heard.some((root) => touches(root, rel))) w.gen++;
    });
  watches.set(dir, w);
}

/** Stop watching before anything renames the folder these roots sit in — see docs/moduleWatch.md. */
export function closeModuleWatch(dir?: string): void {
  for (const [at, w] of watches)
    if (dir === undefined || at === dir) {
      w.unsubscribe?.();
      for (const h of w.handles) {
        try {
          h.close();
        } catch {
          /* already closed */
        }
      }
      watches.delete(at);
    }
}

/**
 * Close every watch on `abs` and on anything under it. A watched directory cannot be RENAMED on
 * Windows — the handle answers EPERM — so deleting a project or a workspace has to let go first.
 * `closeModuleWatch` alone is not enough: the caller holds a folder, not the project paths in it.
 */
export function closeModuleWatchesUnder(abs: string): void {
  const under = `${abs}${sep}`;
  for (const dir of [...watches.keys()])
    if (dir === abs || dir.startsWith(under)) closeModuleWatch(dir);
}

/** Which projects are watched right now — for a test that has to see the handles go. */
export function watchedProjects(): string[] {
  return [...watches.keys()].sort();
}

/** THIS process wrote something, so treat every watch as moved — see docs/moduleWatch.md. */
export function moduleFoldersMoved(): void {
  for (const w of watches.values()) w.gen++;
}

/** Whether `dir`'s module folders are KNOWN not to have moved; false is always safe (docs/moduleWatch.md). */
export function moduleFoldersStill(dir: string): boolean {
  const w = watches.get(dir);
  if (!w) return false;
  const now = Date.now();
  if (w.gen !== w.seen || now - w.at > WALK_ANYWAY_MS) {
    w.seen = w.gen;
    w.at = now;
    return false;
  }
  return true;
}

/** Let `@studio/song` ask; called once by the process, so a CLI run or a test just keeps walking. */
export function installModuleWatch(): void {
  setFoldersStill(moduleFoldersStill);
}
