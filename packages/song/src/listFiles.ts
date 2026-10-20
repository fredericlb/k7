// listFiles.ts — every file under a folder, as root-relative POSIX paths, depth first in directory
// order. A folder that cannot be read lists nothing, the way a missing one does.
// Built on Dirents, so a symlinked folder is NOT entered: a walk that must follow one stats instead.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ListFilesOptions {
  /** How many folders deep below `root` to look; unbounded when absent. */
  maxDepth?: number;
  /** Folder names never entered, beside the dot-entries every walk skips. */
  skipDirs?: readonly string[];
  /** Keep dot-entries, files and folders, rather than skipping them. */
  dotfiles?: boolean;
  /** Only regular files: no symlink, socket or device. */
  regularOnly?: boolean;
}

export function listFilesUnder(
  root: string,
  opts: ListFilesOptions = {},
): string[] {
  const { maxDepth = Number.POSITIVE_INFINITY, skipDirs = [] } = opts;
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!opts.dotfiles && e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < maxDepth && !skipDirs.includes(e.name))
          walk(join(abs, e.name), child, depth + 1);
      } else if (!opts.regularOnly || e.isFile()) out.push(child);
    }
  };
  walk(root, "", 0);
  return out;
}
