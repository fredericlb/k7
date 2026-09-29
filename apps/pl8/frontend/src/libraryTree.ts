// libraryTree.ts — a family's listing as the rows the tree draws, and the way back from a row to
// its entry. Pure: no fetch and no React, so the tree's shape is tested on its own.
// The one thing a reader would get wrong: a tree path is FAMILY-relative, an entry's path is not (../docs/library.md).

import type { TreeNode } from "@frediverse/ui/file-tree";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { MediatekEntry } from "@studio/mediatek/types";
import { folderAt } from "./assetTree";

/** Is this entry a SONG? The family alone answers — the scan stopped at the folder (../docs/library.md). */
export const isSong = (e: MediatekEntry): boolean => e.family === "songs";

/** What `revealed` starts on: a NUL byte names no row, so only the top level unfolds (../docs/library.md). */
export const TOP_LEVEL = "\u0000";

/** Drop the leading family segment — the tab already names it, and so does the tree root. */
export function relative(path: string): string {
  return path.split("/").filter(Boolean).slice(1).join("/");
}

/** A tree path (family-relative) back to its entry, keyed on the FULL path — two families can hold the same name. */
export function entryAt(
  entries: MediatekEntry[] | null,
  path: string,
): MediatekEntry | null {
  return (entries ?? []).find((e) => relative(e.path) === path) ?? null;
}

/** …and for a SONG, the one row of that family a menu may act on (../docs/library.md). */
export const isSongFolder = (
  entries: MediatekEntry[] | null,
  path: string,
): boolean => {
  const e = path ? entryAt(entries, path) : null;
  return !!e && isSong(e);
};

/** The family's entries as a folder tree, from their paths alone (../docs/library.md). */
export function treeOf(
  entries: MediatekEntry[] | null,
  unlisted: string[],
): TreeNode[] {
  const roots: TreeNode[] = [];
  // What no entry accounts for goes in FIRST, so an entry arriving later finds its folder already there.
  for (const rel of unlisted) {
    const cut = rel.lastIndexOf("/");
    const isFile = /\.[^./]+$/.test(rel);
    if (isFile) {
      const into = cut < 0 ? roots : folderAt(roots, rel.slice(0, cut));
      into.push({ name: rel.slice(cut + 1), path: rel });
    } else folderAt(roots, rel);
  }
  for (const e of entries ?? []) {
    // The family segment leads every path and is what the tabs already name.
    const parts = e.path.split("/").filter(Boolean).slice(1);
    let level = roots;
    let sofar = "";
    parts.forEach((part, i) => {
      sofar = sofar ? `${sofar}/${part}` : part;
      const leaf = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        // A SONG stays folder-shaped — its own drop target for a variant — but folds nothing (../docs/library.md).
        const folds = leaf && e.family !== "songs";
        node = folds
          ? { name: part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
      }
      if (!leaf) level = node.children ??= [];
    });
  }
  return roots;
}

/** The capture zone as tree rows: one folder per day, one row per capture (../docs/library.md). */
export function dayNodes(days: RecordingDay[]): TreeNode[] {
  return days.map((d) => ({
    name: d.day,
    path: d.day,
    dir: true,
    children: d.files.map((f) => ({
      name: f.name,
      path: `${d.day}/${f.name}`,
    })),
  }));
}

/** A size the way the rows print it. */
export function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
