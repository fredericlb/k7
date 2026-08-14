// libraryTree.ts — the médiathèque's module listing as the file tree's nodes: one row per
// namespace, the type/category folders under it, and each module as the folder it is on disk.
// Paths stay LIBRARY-relative, which is the path space the library store reads and writes in.
// Why the tab exists at all: apps/l8/frontend/docs/sharedModules.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { ModuleNamespace } from "@studio/song/moduleTypes";
import type { FileNode } from "@studio/web-protocol";

/**
 * The namespace the médiathèque's modules answer to.
 *
 * Taken from `@studio/song`'s union rather than spelt here, because it is the same word a chain
 * writes in a ref — `@mediatek/audio/delay/tape-delay` — and a tab that named the library
 * something else would be labelling rows nobody could find in a chains file.
 */
export const MEDIATEK_NS: ModuleNamespace = "mediatek";

/** How a namespace is written wherever a person reads one: in a ref, and now on a tree row. */
export const nsLabel = (ns: ModuleNamespace): string => `@${ns}`;

/**
 * The listing as tree rows, under one synthesised namespace root.
 *
 * Synthesised because the shared tree draws no row for its own root (`rootLabel` is a label and
 * nothing else), and the root is the one row that says WHICH library you are looking at — the
 * tab is called Libraries in the plural on purpose, and `@workspace` is a second one the day a
 * workspace holds a `_modules` folder.
 *
 * A module is a FOLDER carrying its own files, and it is left as one here: l8's `foldModules`
 * is what turns it into a single row, by finding the `module.yaml` among those children. Doing
 * that fold twice, once per source, is how the two trees would come to open modules differently.
 */
export function libraryTree(entries: MediatekEntry[]): FileNode[] {
  const roots: FileNode[] = [];
  for (const e of entries) {
    // The family segment leads every mediatek path and is what the namespace row already says.
    const parts = e.path.split("/").filter(Boolean).slice(1);
    if (!parts.length) continue;
    let level = roots;
    let sofar = "";
    parts.forEach((part, i) => {
      sofar = sofar ? `${sofar}/${part}` : part;
      const path = `${familyOf(e.path)}/${sofar}`;
      const leaf = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path, dir: true, children: [] };
        level.push(node);
        // A module's children are the files it actually holds — its nodes, its panel, its
        // shelf, a jsdsp source. `files` is what the scan found, so a row for a file that is
        // not there cannot appear; and `module.yaml` being among them is what folds the row.
        if (leaf)
          node.children = (e.files ?? []).map((f) => ({
            name: f,
            path: `${path}/${f}`,
            dir: false,
            kind: "text" as const,
          }));
      }
      if (!leaf) level = node.children ??= [];
    });
  }
  sortTree(roots);
  return [
    {
      name: nsLabel(MEDIATEK_NS),
      // Not a path anything reads: the row is the library, and a library is not a file. Spelt
      // as the namespace so the tree's expansion state is keyed on something stable.
      path: nsLabel(MEDIATEK_NS),
      dir: true,
      children: roots,
    },
  ];
}

/** The family a mediatek path is in — its first segment, which every entry carries. */
const familyOf = (path: string): string => path.split("/")[0] ?? "";

/** Folders before files, then by name — the order the listing does not come in. */
function sortTree(nodes: FileNode[]): void {
  nodes.sort(
    (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
  );
  for (const n of nodes) if (n.children) sortTree(n.children);
}

/**
 * The ref a chain writes for one of a library module's FILES —
 * `modules/audio/delay/tape-delay/module.yaml` → `@mediatek/audio/delay/tape-delay`.
 *
 * What lets the builder find the LIVE plugin behind a shared module: the open project names it
 * by this ref, not by a folder inside itself, so the lookup that works for a project module
 * (`moduleKeyFromPath`) answers nothing here.
 *
 * A FILE path and never a folder, so the last segment is always the one to drop. Asking whether
 * a segment "looks like a file" would be a guess, and `modules/audio/tape.delay` is a module
 * somebody is allowed to name. Null for anything that is not a file inside a module folder.
 */
export function libraryModuleRef(file: string): string | null {
  const parts = file.split("/").filter(Boolean);
  if (parts[0] !== "modules") return null;
  const segs = parts.slice(1, -1);
  return segs.length >= 2 ? `${nsLabel(MEDIATEK_NS)}/${segs.join("/")}` : null;
}
