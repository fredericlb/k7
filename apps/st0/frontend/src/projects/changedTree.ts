// changedTree.ts — a workspace tree marked with what git has not committed: which paths, which
// folders hold one, and the changed paths the walk did not list (deleted, or newer than the walk).
// Tree paths use the SERVER's separator, git's always `/`: every lookup goes through `slash`.

import type { FileNode, GitChange } from "@studio/web-protocol";

export const slash = (p: string): string => p.replace(/\\/g, "/");

export interface Changed {
  /** Status letters by `/` path. */
  codes: Map<string, string>;
  /** Every folder, by `/` path, with a changed path somewhere below it. */
  dirs: Set<string>;
}

export function changedOf(changes: GitChange[]): Changed {
  const codes = new Map<string, string>();
  const dirs = new Set<string>();
  for (const c of changes) {
    const path = slash(c.path).replace(/\/$/, "");
    codes.set(path, c.code);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      dirs.add(parts.slice(0, i).join("/"));
  }
  return { codes, dirs };
}

/** The tree with a file node added for every changed path it lacks, folders created on the way. */
export function withChanges(
  nodes: FileNode[],
  changes: GitChange[],
): FileNode[] {
  const seen = new Set<string>();
  const visit = (ns: FileNode[]) => {
    for (const n of ns) {
      seen.add(slash(n.path));
      if (n.children) visit(n.children);
    }
  };
  visit(nodes);
  const missing = changes.map((c) => slash(c.path)).filter((p) => !seen.has(p));
  if (!missing.length) return nodes;
  const root = structuredClone(nodes);
  for (const path of missing) {
    const parts = path.split("/");
    let level = root;
    for (let i = 0; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join("/");
      const leaf = i === parts.length - 1;
      let node = level.find((n) => slash(n.path) === sub);
      if (!node) {
        node = leaf
          ? { name: parts[i], path: sub, dir: false, kind: "text" }
          : { name: parts[i], path: sub, dir: true, children: [] };
        level.push(node);
      }
      if (leaf) break;
      node.children ??= [];
      level = node.children;
    }
  }
  return root;
}
