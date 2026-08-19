// assetTree.ts — walking a slash-separated path into tree rows, creating the folders on the
// way. Two callers, one operation at two roots: the family's own entries, and what a module
// carries under `assets/`. Pure, so the nesting is testable without a screen.

import type { TreeNode } from "@frediverse/ui/file-tree";

/**
 * Walk a folder path into `roots`, creating what is missing. Returns the level INSIDE it, so a
 * caller can keep descending.
 *
 * `base` prefixes the `path` of every node made — the row's real address on the server, which
 * is not always where it sits in the tree. A module's assets are the case: they are drawn as
 * the module's children, and the `assets/` segment they actually live under is in `base` and
 * nowhere on screen.
 */
export function folderAt(
  roots: TreeNode[],
  rel: string,
  base = "",
): TreeNode[] {
  let level = roots;
  let sofar = base;
  for (const part of rel.split("/").filter(Boolean)) {
    sofar = sofar ? `${sofar}/${part}` : part;
    let node = level.find((n) => n.name === part);
    if (!node) {
      node = { name: part, path: sofar, dir: true, children: [] };
      level.push(node);
    }
    level = node.children ??= [];
  }
  return level;
}

/**
 * What a module carries, as rows — its `assets/` listing (see `MediatekEntry.assets`) nested
 * back into folders.
 *
 * The listing is nested paths because that is how this material arrives: a NAM pack is a folder
 * per amp, an IR pack a folder per cabinet. Flattening a hundred profiles into one level is
 * exactly what makes a picker unusable, and it would also make the folders undroppable —
 * the shared tree decides what is a drop target from `dir` alone.
 *
 * `base` is where they really live (`audio/amps/guitar/assets`), so every row addresses the
 * file that is actually there: a drop, a move, a rename and a delete all go through the path.
 * The segment itself is not drawn — a module's children ARE its assets, and a fixed `assets`
 * row between them and it would be a level with nothing to choose in it.
 *
 * A path ending in `/` is a folder holding nothing. It makes a row and stops, which is the
 * whole point of the scan bothering to report it: somewhere to drop into before the first file.
 */
export function assetNodes(assets: string[], base: string): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const rel of assets) {
    if (rel.endsWith("/")) {
      folderAt(roots, rel, base);
      continue;
    }
    const cut = rel.lastIndexOf("/");
    const level = folderAt(roots, cut < 0 ? "" : rel.slice(0, cut), base);
    const name = rel.slice(cut + 1);
    // The scan emits each path once, and never a folder marker beside a path under it — but a
    // listing is what a server said, not an invariant this holds. A row already there wins: it
    // may be a folder, and replacing it with a leaf would hide its children.
    if (!level.some((n) => n.name === name))
      level.push({ name, path: base ? `${base}/${rel}` : rel });
  }
  return roots;
}
