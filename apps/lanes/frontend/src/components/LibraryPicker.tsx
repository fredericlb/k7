// LibraryPicker.tsx — "which file?", asked by a module's library dropdown (a cabinet IR,
// a NAM profile). The same popup as the `+` on a graph arrow, deliberately: both browse a
// nested catalogue and both want a search field, and two pickers behaving differently
// would be a coin toss. The shell is TreePicker; this only says what the tree is.
//
// The catalogue is the library's own folders. These arrive nested — a NAM pack is a folder
// per amp, an IR pack a folder per cabinet then per mic — and the flat <select> this
// replaces listed all 300 of them in one scroll, alphabetically, with the folder ground
// into the filename.

import { fuzzyScore } from "../fuzzy";
import { type TreeNode, TreePicker } from "./TreePicker";

const SEARCH_LIMIT = 40;

/** The file name without its extension — what a leaf is labelled with. */
const stem = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

/**
 * Library-relative paths → one level per folder.
 *
 * `nam/Two-Rock/Clean/a.nam` under kind `nam` → level "Two-Rock" → level "Clean" → leaf "a".
 *
 * The KIND prefix is dropped: the widget already says which library it browses, so
 * repeating "nam/" on every row costs width and tells you nothing. A file sitting directly
 * in the kind's folder becomes a leaf at the root, beside the folders.
 */
export function buildLibraryTree(
  files: string[],
  kind: string,
): TreeNode<string>[] {
  const prefix = `${kind}/`;
  // A folder's children by path, so a level can be built without re-walking the list.
  const roots: TreeNode<string>[] = [];
  const dirs = new Map<string, TreeNode<string>>();

  const folderFor = (path: string): TreeNode<string>[] => {
    if (!path) return roots;
    const existing = dirs.get(path);
    if (existing) return existing.children as TreeNode<string>[];
    const parent = folderFor(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
    const node: TreeNode<string> = {
      key: `d:${path}`,
      label: path.slice(path.lastIndexOf("/") + 1),
      children: [],
    };
    dirs.set(path, node);
    parent.push(node);
    return node.children as TreeNode<string>[];
  };

  for (const file of [...files].sort()) {
    if (!file.startsWith(prefix)) continue;
    const rel = file.slice(prefix.length); // "Two-Rock/Clean/a.nam"
    const cut = rel.lastIndexOf("/");
    folderFor(cut < 0 ? "" : rel.slice(0, cut)).push({
      key: `f:${file}`,
      label: stem(file),
      entry: file, // what the caller writes to the module — the full library-relative path
    });
  }

  // Folders before files at every level: a folder is a place to go, a file is the answer,
  // and mixing them alphabetically buries the structure.
  const order = (nodes: TreeNode<string>[]): TreeNode<string>[] => {
    for (const n of nodes) if (n.children) order(n.children);
    nodes.sort((a, b) => {
      const ad = a.children ? 0 : 1;
      const bd = b.children ? 0 : 1;
      return ad - bd || a.label.localeCompare(b.label);
    });
    return nodes;
  };
  return order(roots);
}

/**
 * Flat matches for a query, best first. Scored on the file's own name AND on its whole
 * path, so both "jcm" and "marshall/jcm" find `nam/Marshall/jcm800.nam` — the folder is
 * half of what you remember about a profile.
 */
export function searchLibrary(
  files: string[],
  kind: string,
  query: string,
): TreeNode<string>[] {
  const q = query.trim();
  if (!q) return [];
  const prefix = `${kind}/`;
  const scored: { node: TreeNode<string>; score: number }[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rel = file.slice(prefix.length);
    const best = Math.max(fuzzyScore(q, stem(file)), fuzzyScore(q, rel));
    if (best <= 0) continue;
    scored.push({
      node: {
        key: `f:${file}`,
        label: stem(file),
        entry: file,
        // The folder path, so two profiles with the same name stay distinguishable.
        hint: rel.includes("/")
          ? rel.slice(0, rel.lastIndexOf("/"))
          : undefined,
      },
      score: best,
    });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label),
  );
  return scored.slice(0, SEARCH_LIMIT).map((s) => s.node);
}

export function LibraryPicker({
  x,
  y,
  kind,
  files,
  onPick,
  onClose,
}: {
  x: number; // viewport coords of the widget that opened it
  y: number;
  kind: string; // "nam", "ir" — the library folder being browsed
  files: string[]; // every library file, kind-prefixed; filtered here
  /** The library-relative path, or "" to clear — an asset is a real choice to UNMAKE. */
  onPick: (file: string) => void;
  onClose: () => void;
}) {
  const tree = buildLibraryTree(files, kind);
  // "none" first and always: a convolver with no IR is a legitimate state, and it must not
  // be something you have to hunt for among the files.
  const withNone: TreeNode<string>[] = [
    { key: "none", label: "— none —", entry: "" },
    ...tree,
  ];
  return (
    <TreePicker<string>
      x={x}
      y={y}
      tree={withNone}
      search={(q) => searchLibrary(files, kind, q)}
      searchLimit={SEARCH_LIMIT}
      placeholder={`search ${kind}…`}
      emptyLabel={`no ${kind} file matches`}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
