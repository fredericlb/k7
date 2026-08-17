// moduleWatch.ts — watch a project's module folders so `@studio/song`'s stamp walk becomes
// rare instead of per-read. One recursive `fs.watch` per root, a generation counter, and a
// ceiling that walks anyway now and then so a missed event heals itself. Full rationale:
// docs/moduleWatch.md.

import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import { setFoldersStill } from "@studio/song/moduleCache";
import { modulePanelRoots } from "@studio/song/sharedFolders";

/**
 * How long the watcher may be believed before the disk is consulted anyway.
 *
 * A ceiling, not a cache interval: it is what makes a MISSED event a delay instead of a
 * permanent lie. `fs.watch` drops events under load, across network shares and on some Linux
 * filesystems, and a vocabulary that went stale for good is exactly the failure this whole file
 * has to not introduce. Ten seconds is far longer than a burst of saves and far shorter than
 * anyone's patience with a module that will not appear.
 */
export const WALK_ANYWAY_MS = 10_000;

/** The roots a project's module vocabulary is read from — the same list the stamp walks. */
const rootsOf = (dir: string): string[] => [
  ...modulePanelRoots(dir),
  join(dir, "nodes"),
];

interface Watch {
  handles: FSWatcher[];
  /** Bumped by every event on every root. Only its CHANGES matter, never its value. */
  gen: number;
  /** The generation the last walk saw, and when that walk was. */
  seen: number;
  at: number;
}

const watches = new Map<string, Watch>();

/**
 * Watch `dir`'s module folders. Idempotent, and silent when the platform will not have it.
 *
 * Recursive `fs.watch` rather than chokidar, for two reasons that both matter here. It is ONE
 * handle per root instead of one per directory, so a library of 150 modules costs four handles
 * — and, on Windows, a handle held on a root does not stop a folder INSIDE it being renamed,
 * which is what a module rename is. And this needs a single bit, not a description of what
 * changed: chokidar's whole job is telling you which file it was.
 */
export function watchModuleFolders(dir: string): void {
  if (watches.has(dir)) return;
  const w: Watch = { handles: [], gen: 0, seen: 0, at: 0 };
  for (const root of rootsOf(dir)) {
    try {
      const h = watch(root, { recursive: true, persistent: false }, () => {
        w.gen++;
      });
      // A root that goes away mid-flight must not take the process with it — and losing the
      // watch is itself a change, so it counts as one.
      h.on("error", () => {
        w.gen++;
      });
      w.handles.push(h);
    } catch {
      // Not there (a project with no `modules/` yet), or recursive watching unsupported. Either
      // way this root simply is not covered, and the ceiling below is what keeps that honest.
    }
  }
  watches.set(dir, w);
}

/**
 * Stop watching, before anything renames the folder these roots sit in.
 *
 * On Windows an open handle on a directory is what makes its PARENT refuse to be renamed, and
 * recycling a project renames the project folder. Same discipline `closeStrudelWatcher` states;
 * `renameWithRetry` is the net under both. No await here — `fs.watch` closes synchronously.
 *
 * With no argument, everything: that is process shutdown, and a test tearing down.
 */
export function closeModuleWatch(dir?: string): void {
  for (const [at, w] of watches)
    if (dir === undefined || at === dir) {
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
 * Whether `dir`'s module folders are KNOWN not to have moved since the last walk.
 *
 * False is always a safe answer and is the answer whenever anything is uncertain: nobody is
 * watching this project, an event arrived, or the ceiling ran out. Saying false costs a walk;
 * saying true wrongly costs a module served under a name nobody wrote, so the three conditions
 * are all one-directional.
 */
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

/**
 * Let `@studio/song` ask. Called once by the process; nothing else installs it, which is why a
 * CLI run, a test and a script all keep walking exactly as before.
 */
export function installModuleWatch(): void {
  setFoldersStill(moduleFoldersStill);
}
