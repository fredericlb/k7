// libraryTree.ts — the LIBRARIES tab: one row per module namespace, the modules of each under
// it. All three come out of the workspace tree the file service already serves — they are
// ordinary folders — so this only finds them and labels them.
// Why the tab exists at all: apps/l8/frontend/docs/sharedModules.md.

import {
  LIBRARIES_DIR,
  type ModuleNamespace,
  SHARED_MODULES_DIR,
} from "@studio/song/moduleTypes";
import type { FileNode } from "@studio/web-protocol";

/** The folder that holds modules, in every one of the three levels below. */
const MODULES = "modules";

/** How a namespace is written wherever a person reads one: in a ref, and on a tree row. */
export const nsLabel = (ns: ModuleNamespace): string => `@${ns}`;

/** The account's library repository — kept as a name because two other files import it. */
export const LIBRARY_NS: ModuleNamespace = "st0";

/** `_libraries/modules`, where the account's library keeps its modules. */
export const LIBRARY_MODULES = `${LIBRARIES_DIR}/${MODULES}`;

/**
 * The three levels a module can live at that HAVE a folder, nearest first.
 *
 * The same order and the same places `@studio/song`'s `modulePanelRoots` walks, which is what
 * keeps this tab from listing a vocabulary the loader does not agree with. `@engine` is the
 * fourth level and is not here: a scanned plugin has no folder at all, so there is nothing to
 * draw and nothing to open.
 *
 * Order is PRECEDENCE — a project's own module wins over the workspace's, which wins over the
 * account's — so reading the tab top to bottom is reading the order the loader resolves in.
 */
const LEVELS: {
  ns: ModuleNamespace;
  at: (project: string | null) => string;
}[] = [
  { ns: "project", at: (p) => (p && p !== "." ? `${p}/${MODULES}` : MODULES) },
  // No `modules/` inside it: a workspace library holds its type folders directly, where the
  // account's repository holds two FAMILIES and `modules` is one of them. The two shapes
  // differ and always have — see `@studio/song`'s docs/sharedFolders.md.
  { ns: "workspace", at: () => SHARED_MODULES_DIR },
  { ns: "st0", at: () => LIBRARY_MODULES },
];

/**
 * Every module folder this project can reach, as tree rows under a synthesised namespace row.
 *
 * Synthesised because the shared tree draws no row for its own root (`rootLabel` is a label and
 * nothing else), and the row is the one thing that says WHICH library you are looking at. A
 * level with no folder, or an empty one, contributes nothing — an empty `@workspace` heading
 * would be a place to put something, and this tab is a view rather than a place.
 *
 * The subtrees are passed through UNTOUCHED. They are already `FileNode[]` from the file
 * service, already the right shape, and l8's `foldModules` is what turns a module folder into a
 * single row — the same fold the Project tab uses, so the two cannot come to draw a module
 * differently.
 */
export function libraryTree(
  tree: FileNode[],
  activeProject: string | null,
): FileNode[] {
  const out: FileNode[] = [];
  for (const { ns, at } of LEVELS) {
    const node = findNode(tree, at(activeProject));
    if (!node?.children?.length) continue;
    out.push({
      name: nsLabel(ns),
      // The real path, so every row under it — and every read and write — addresses the file
      // that is actually there. They are workspace paths like any other.
      path: node.path,
      dir: true,
      children: node.children,
    });
  }
  return out;
}

/**
 * The folders the Libraries tab has taken over, which the Project tab therefore drops.
 *
 * Shown twice they would be two ways into one module — one that opens the builder and one that
 * browses its files — and the folder a module lives in is the loader's business, not something
 * to drop files into by hand. Derived from the SAME list the tab is built from, so a level can
 * never appear in both places or vanish from both.
 *
 * Whatever `_libraries` also holds (`chains/`) goes with it: the submodule is not this song's
 * to browse, and its chains are opened from st0.
 */
export function librariesOwned(activeProject: string | null): string[] {
  return [LIBRARIES_DIR, ...LEVELS.map(({ at }) => at(activeProject))];
}

/** The node at an exact workspace-relative path, or null. Walks by SEGMENT, never by prefix:
 *  a folder called `_librariesX` is not this one. */
function findNode(nodes: FileNode[], path: string): FileNode | null {
  let level: FileNode[] | undefined = nodes;
  let found: FileNode | null = null;
  for (const seg of path.split("/")) {
    found = level?.find((n) => n.name === seg) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

/** The tree with those folders removed, at whatever depth they sit. */
export function withoutPaths(nodes: FileNode[], paths: string[]): FileNode[] {
  const drop = new Set(paths);
  const walk = (ns: FileNode[]): FileNode[] =>
    ns
      .filter((n) => !drop.has(n.path))
      .map((n) => (n.children ? { ...n, children: walk(n.children) } : n));
  return walk(nodes);
}

/**
 * The ref a chain writes for one of a SHARED module's files —
 * `_libraries/modules/audio/delay/tape-delay/module.yaml` → `@st0/audio/delay/tape-delay`,
 * `_modules/audio/reverb/module.yaml` → `@workspace/audio/reverb`.
 *
 * What lets the builder find the LIVE plugin behind a shared module: the open project names it
 * by this ref, not by a folder inside itself, so `moduleKeyFromPath` — which reads a project's
 * own `modules/` — answers nothing for either of these. A PROJECT module is not handled here
 * for exactly that reason: it is already what that function is for.
 *
 * A FILE path and never a folder, so the last segment is always the one to drop. Asking whether
 * a segment "looks like a file" would be a guess, and `modules/audio/tape.delay` is a module
 * somebody is allowed to name.
 */
export function libraryModuleRef(file: string): string | null {
  const parts = file.split("/").filter(Boolean);
  const at = parts.indexOf(LIBRARIES_DIR);
  if (at >= 0)
    return parts[at + 1] === MODULES
      ? refOf("st0", parts.slice(at + 2, -1))
      : null;
  const shared = parts.indexOf(SHARED_MODULES_DIR);
  return shared >= 0 ? refOf("workspace", parts.slice(shared + 1, -1)) : null;
}

/** `<type>/<sub>` under a level, or null when there is no module there to name. */
const refOf = (ns: ModuleNamespace, segs: string[]): string | null =>
  segs.length >= 2 ? `${nsLabel(ns)}/${segs.join("/")}` : null;

/**
 * Is this workspace path inside the ACCOUNT's library?
 *
 * What decides whether the builder opens read-only behind a confirmation, and whether a save
 * publishes. Only `_libraries` — a `@workspace` module is shared too, but it has a way back
 * already: a save aimed at it forks into the project (`packages/song/docs/moduleFork.md`),
 * which is the older answer to the same question and needs no gate in front of it.
 */
export const isLibraryPath = (path: string): boolean =>
  path.split("/").includes(LIBRARIES_DIR);
