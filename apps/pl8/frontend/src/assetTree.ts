// assetTree.ts — walking a slash-separated path into tree rows, creating the folders on the
// way. Two callers, one operation at two roots: the family's own entries, and what a module
// carries under `assets/`. Pure, so the nesting is testable without a screen.

import type { TreeNode } from "@frediverse/ui/file-tree";

/** Walk a folder path into `roots`, creating what is missing; `base` is the row's real address. */
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

/** A module's `assets/` listing nested back into folders, addressed under `base` (../docs/library.md). */
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
    // A row already there WINS: it may be a folder, and a leaf would hide its children.
    if (!level.some((n) => n.name === name))
      level.push({ name, path: base ? `${base}/${rel}` : rel });
  }
  return roots;
}
