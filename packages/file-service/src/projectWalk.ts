// projectWalk.ts — ONE stat walk of a project, and the change token read off it: the mutation
// counter, the count of SOURCE files and the newest mtime. Three readers share one walk, which
// Workspace.withWalk opens. See docs/workspace.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXTS_PATH } from "@studio/song/engineCatalogue";
import { modelsRoot } from "@studio/song/modelCache";
import { PREFS_PATH } from "@studio/song/preferences";
import { isBinary, skip } from "./workspaceFilter.ts";

// What moves the revision; a .vstpreset is rewritten in place by its window — packages/song/docs/autoFreeze.md.
const REVISION_FILE = /\.(k7x|vstpreset)$/i;

/** One file found by `walkProject`, from a single `statSync` — see docs/workspace.md. */
export interface WalkedFile {
  abs: string;
  size: number;
  mtimeMs: number;
  binary: boolean;
  source: boolean;
}

/** One file's mtime, or 0 when it is not there — absent is a state, not a failure. */
const mtimeOf = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

/** Every file under `dir` the workspace shows, or only its SOURCES — the narrow walk a bare token needs. */
export function walkProject(dir: string, sourcesOnly = false): WalkedFile[] {
  const out: WalkedFile[] = [];
  const walk = (abs: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // unreadable — treated as empty rather than failing the caller
    }
    for (const e of entries) {
      if (skip(e.name)) continue;
      const p = join(abs, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      // A project SOURCE — an out-of-band edit to one moves the token, a media copy does not.
      const source = REVISION_FILE.test(e.name);
      if (sourcesOnly && !source) continue;
      try {
        const s = statSync(p);
        out.push({
          abs: p,
          size: s.size,
          mtimeMs: s.mtimeMs,
          binary: isBinary(e.name),
          source,
        });
      } catch {
        /* raced away between readdir and stat — the next walk sees it */
      }
    }
  };
  walk(dir);
  return out;
}

/** The token from a walk: the mutation counter, the SOURCE count, and the newest mtime. */
export function revisionOf(files: WalkedFile[], mutations: number): string {
  // …and the two files OUTSIDE the project a derived view still reads — see docs/workspace.md.
  let newest = mtimeOf(EXTS_PATH);
  const prefsAt = mtimeOf(PREFS_PATH);
  if (prefsAt > newest) newest = prefsAt;
  // A model arriving in the machine's cache changes what the graph offers to download.
  const modelsAt = mtimeOf(modelsRoot());
  if (modelsAt > newest) newest = modelsAt;
  let count = 0;
  for (const f of files) {
    if (!f.source) continue;
    count++;
    if (f.mtimeMs > newest) newest = f.mtimeMs;
  }
  return `${mutations}:${count}:${newest}`;
}
