// libraryTree.ts — the shared libraries as the file tree's second tab: one row per namespace,
// the catalogue under it. The rows come straight out of the WORKSPACE tree — the libraries are
// a git submodule at `_libraries/`, so they are ordinary folders the file service already
// serves. Why the tab exists at all: apps/l8/frontend/docs/sharedModules.md.

import { LIBRARIES_DIR, type ModuleNamespace } from "@studio/song/moduleTypes";
import type { FileNode } from "@studio/web-protocol";

/**
 * The namespace the account's library repository answers to.
 *
 * Typed from `@studio/song`'s union rather than left a loose string, because it is the same word
 * a chain writes in a ref — `@st0/audio/delay/tape-delay` — and a tab that named the library
 * something else would be labelling rows nobody could find in a chains file.
 */
export const LIBRARY_NS: ModuleNamespace = "st0";

/** How a namespace is written wherever a person reads one: in a ref, and now on a tree row. */
export const nsLabel = (ns: ModuleNamespace): string => `@${ns}`;

/** The family inside the library repository that holds modules. `chains/` is the other one. */
const MODULES = "modules";

/** `_libraries/modules`, the path every row below sits under. */
export const LIBRARY_MODULES = `${LIBRARIES_DIR}/${MODULES}`;

/**
 * The library's modules as tree rows, under one synthesised namespace root — or `[]` when the
 * submodule is not mounted in this workspace.
 *
 * Synthesised because the shared tree draws no row for its own root (`rootLabel` is a label and
 * nothing else), and the root is the one row that says WHICH library you are looking at — the
 * tab is called Libraries in the plural on purpose, and `@workspace` is a second one the day a
 * workspace holds a `_modules` folder.
 *
 * The subtree is passed through UNTOUCHED. It is already `FileNode[]` from the file service,
 * already the right shape, and l8's `foldModules` is what turns a module folder into a single
 * row — the same fold the Project tab uses, so the two cannot come to draw a module differently.
 * This used to convert a médiathèque listing into nodes; the libraries live in the workspace
 * now, so there is nothing left to convert.
 */
export function libraryTree(tree: FileNode[]): FileNode[] {
  const modules = findNode(tree, LIBRARY_MODULES);
  if (!modules?.children?.length) return [];
  return [
    {
      name: nsLabel(LIBRARY_NS),
      // The real path, so every row under it — and every read and write — addresses the file
      // that is actually there. It is a workspace path like any other: that is the whole point
      // of the submodule sitting inside the workspace.
      path: modules.path,
      dir: true,
      children: modules.children,
    },
  ];
}

/** The node at an exact workspace-relative path, or null. Walks by SEGMENT, never by prefix:
 *  a folder called `_librariesX` is not this one. */
function findNode(nodes: FileNode[], path: string): FileNode | null {
  const want = path.split("/");
  let level: FileNode[] | undefined = nodes;
  let found: FileNode | null = null;
  for (const seg of want) {
    found = level?.find((n) => n.name === seg) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

/**
 * The ref a chain writes for one of a library module's FILES —
 * `_libraries/modules/audio/delay/tape-delay/module.yaml` → `@st0/audio/delay/tape-delay`.
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
  const at = parts.indexOf(LIBRARIES_DIR);
  if (at < 0 || parts[at + 1] !== MODULES) return null;
  const segs = parts.slice(at + 2, -1);
  return segs.length >= 2 ? `${nsLabel(LIBRARY_NS)}/${segs.join("/")}` : null;
}

/** Is this workspace path inside the library submodule? What decides whether the builder opens
 *  read-only — a shared module is everyone's copy, and nothing here forks. */
export const isLibraryPath = (path: string): boolean =>
  path.split("/").includes(LIBRARIES_DIR);
