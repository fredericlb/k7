// workspaceFilter.ts — which names a workspace hides, which files it never reads as text, and the walk that applies both.
// Its own module so a process that only WATCHES a folder (the hub's library replicas) need not load workspace.ts.

import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

// Files shown in the tree but not editable as text.
const BINARY_EXT = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".vstpreset",
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
]);
export const isBinary = (name: string): boolean =>
  BINARY_EXT.has(extname(name).toLowerCase());

// Where deleted entries go — hidden by skip(), so "deleting" is a reversible move.
export const RECYCLE_DIR = "_recycle_bin";

// The undo/redo journal folder inside a project; history.ts holds the journal itself.
const HISTORY_DIR = "_history";

// Hidden files and deps are never shown, edited or WATCHED — the strudel watcher prunes this same list.
export const skip = (name: string): boolean =>
  name.startsWith(".") ||
  name === "node_modules" ||
  name === RECYCLE_DIR ||
  name === HISTORY_DIR || // the undo/redo journal, never listed or diffed
  name.endsWith(".cache"); // engine-written waveform sidecars ({source}.cache)

/** Every file under `scope` of `root` (a file or a folder, `/`-separated), minus what `hide` hides by name. */
export function filesUnder(
  root: string,
  scope: string,
  hide: (name: string) => boolean,
): string[] {
  const abs = scope ? join(root, ...scope.split("/")) : root;
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return [scope];
  if (!st.isDirectory()) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (hide(e.name)) continue;
      const child = join(dir, e.name);
      if (e.isDirectory()) visit(child);
      else if (e.isFile()) out.push(relative(root, child).split(sep).join("/"));
    }
  };
  visit(abs);
  return out;
}
