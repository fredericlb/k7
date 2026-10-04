// AssetPicker.tsx — "which file?", asked by a module's filepicker widget (a NAM profile, a
// model). The same popup as the `+` on a graph arrow, deliberately: both browse a nested
// catalogue and both want a search field, and two pickers behaving differently would be a coin
// toss. The shell is TreePicker; this only says what the tree is. See docs/filePicker.md.
//
// The choices are the module's OWN assets/, `assets/`-relative and nested — a NAM pack is a
// folder per amp — so they are filtered by the EXTENSION the bound param takes and never by a
// folder prefix: a module's assets carry no kind prefix, so such a filter matches nothing
// (packages/song/docs/moduleAssets.md).

import { assetsForParam } from "@studio/song-schema/moduleTypes";
import { fuzzyScore } from "../fuzzy";
import { type TreeNode, TreePicker } from "./TreePicker";

const SEARCH_LIMIT = 40;

/** The file name without its extension — what a leaf is labelled with. */
const stem = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

/** Which runtime plays a model file, read off its extension: `.nam` is NAM, any `.json` is an RTNeural net — AIDA-X, or the rarer Proteus. */
export function modelBadge(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".nam") return "NAM";
  if (ext === ".json") return "AIDA";
  return undefined;
}

/** `assets/`-relative paths → one level per folder; a file sitting directly in `assets/` becomes a leaf at the root, beside the folders. */
export function buildAssetTree(
  files: string[],
  param: string,
): TreeNode<string>[] {
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

  for (const file of assetsForParam(files, param).sort()) {
    const cut = file.lastIndexOf("/");
    folderFor(cut < 0 ? "" : file.slice(0, cut)).push({
      key: `f:${file}`,
      label: stem(file),
      entry: file, // what the caller writes to the module — the full assets-relative path
      badge: param === "model" ? modelBadge(file) : undefined,
    });
  }

  // Folders before files at every level: a folder is a place to go and a file is the answer, and mixing them buries the structure.
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

/** Flat matches for a query, best first — scored on the file's own name AND its whole path, the folder being half of what you remember. */
export function searchAssets(
  files: string[],
  param: string,
  query: string,
): TreeNode<string>[] {
  const q = query.trim();
  if (!q) return [];
  const scored: { node: TreeNode<string>; score: number }[] = [];
  for (const file of assetsForParam(files, param)) {
    const best = Math.max(fuzzyScore(q, stem(file)), fuzzyScore(q, file));
    if (best <= 0) continue;
    scored.push({
      node: {
        key: `f:${file}`,
        label: stem(file),
        entry: file,
        badge: param === "model" ? modelBadge(file) : undefined,
        // The folder path, so two profiles with the same name stay distinguishable.
        hint: file.includes("/")
          ? file.slice(0, file.lastIndexOf("/"))
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

export function AssetPicker({
  x,
  y,
  param,
  files,
  onPick,
  onClose,
}: {
  x: number; // viewport coords of the widget that opened it
  y: number;
  param: string; // "model" — the file-valued param being set, which also picks the extension
  files: string[]; // every asset the module can name; filtered here
  /** The assets-relative path, or "" to clear — an asset is a real choice to UNMAKE. */
  onPick: (file: string) => void;
  onClose: () => void;
}) {
  const tree = buildAssetTree(files, param);
  // 'none' first and always: a module with no profile loaded is a legitimate state, not something to hunt for among the files.
  const withNone: TreeNode<string>[] = [
    { key: "none", label: "— none —", entry: "" },
    ...tree,
  ];
  return (
    <TreePicker<string>
      x={x}
      y={y}
      tree={withNone}
      search={(q) => searchAssets(files, param, q)}
      searchLimit={SEARCH_LIMIT}
      placeholder={`search ${param}…`}
      emptyLabel={`no ${param} file matches`}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
