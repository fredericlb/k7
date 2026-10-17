// projectEdited.ts — when a project last changed on this replica, for the home page's row.
// Two levels and no deeper: a project's text sits in its root and one folder down (`nodes/`,
// `surfaces/`…), and a deeper walk would stat every take of a heavy project on each listing.
// See docs/workspaces.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The newest mtime among the entries of `dir` and of its sub-folders, epoch ms; undefined when nothing could be read. */
export function projectEditedAt(dir: string, depth = 2): number | undefined {
  let newest: number | undefined;
  const walk = (d: string, left: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Dot-entries are the replica's own bookkeeping, not an edit anybody made.
      if (e.name.startsWith(".")) continue;
      const at = join(d, e.name);
      if (e.isDirectory()) {
        if (left > 1) walk(at, left - 1);
        continue;
      }
      try {
        const t = statSync(at).mtimeMs;
        if (newest === undefined || t > newest) newest = t;
      } catch {
        // Gone between the readdir and the stat: it changes nothing the row says.
      }
    }
  };
  walk(dir, depth);
  return newest === undefined ? undefined : Math.round(newest);
}
