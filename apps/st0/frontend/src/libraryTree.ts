// libraryTree.ts — the LIBRARIES tab: one row per module level, its modules under it, and the
// library repository as one row with its three families. The
// levels come from the file service (`GET /module-libraries`), which reads the same roots the
// LOADER resolves against — they sit outside the active project, so the file tree does not and
// must not contain them. Why the tab exists: apps/st0/frontend/docs/sharedModules.md.

import {
  LIBRARIES_DIR,
  SHARED_MODULES_DIR,
} from "@studio/song-schema/moduleTypes";
import type { FileNode, ModuleLibrary } from "@studio/web-protocol";

/** How a level is written wherever a person reads one: in a ref, and on a tree row. */
export const nsLabel = (ns: string): string => `@${ns}`;

/** A library chain, as the tab lists it: `ref` is its path under `chains/`, `nodes` its node files. */
export interface LibraryChainRow {
  ref: string;
  path: string;
  nodes?: string[];
}

/** An assembly template of the library: `path` its folder, `file` the `assembly.yaml` the builder opens. */
export interface LibraryAssemblyRow {
  ref: string;
  path: string;
  file: string;
}

/**
 * The libraries as tree rows. `@workspace` and `@engine` are module LEVELS, one row each with their
 * modules under it. `@st0` is different: it is the library REPOSITORY, and it is drawn as one — its
 * three families side by side as they are on disk, `modules/` (the `@st0` module level),
 * `chains/` and `assemblies/`. Drawing `modules/` AS `@st0` and the chains beside it as `@st0/chains`
 * made two siblings read as a folder and its child. `@st0` is the one that disappears when absent.
 */
export function libraryTree(
  libraries: ModuleLibrary[],
  // The library's CHAINS, from the same repository and in the same tab — the builder being what opens one.
  chains: readonly LibraryChainRow[] = [],
  // …and its ASSEMBLY templates, the third family — one leaf each, the assembly builder being what opens one.
  assemblies: readonly LibraryAssemblyRow[] = [],
): FileNode[] {
  return libraries
    .filter((l) => l.exists || l.ns !== "st0")
    .map((l) =>
      l.ns === "st0"
        ? repositoryRow(l, chains, assemblies)
        : {
            name: nsLabel(l.ns),
            // The real path, workspace-relative like every other here; `@engine` has none, its label being all that identifies its row.
            path: l.path || nsLabel(l.ns),
            dir: true,
            children: l.nodes,
          },
    );
}

/** The repository's own folder: the `@st0` level is always its `modules/` (`librariesDirFor`), so its parent. */
function repositoryPath(modules: string): string {
  const at = modules.lastIndexOf("/");
  return at > 0 ? modules.slice(0, at) : LIBRARIES_DIR;
}

function repositoryRow(
  l: ModuleLibrary,
  chains: readonly LibraryChainRow[],
  assemblies: readonly LibraryAssemblyRow[],
): FileNode {
  const root = repositoryPath(l.path);
  return {
    name: nsLabel(l.ns),
    path: root,
    dir: true,
    children: [
      // The module level's own path, untouched: it is what `rootOf` resolves 'New module…' against.
      { name: "modules", path: l.path, dir: true, children: l.nodes },
      {
        name: "chains",
        path: `${root}/chains`,
        dir: true,
        // A chain OPENS and its nodes are under it — a chain with none is still a folder, one node away from having some.
        children: chains.map((c) => ({
          name: c.ref,
          path: c.path,
          dir: true,
          children: (c.nodes ?? []).map((n) => ({
            name: n,
            // The real path, like every other row here — what tells this node's row from its chain's when one is clicked.
            path: `${c.path}/nodes/${n}`,
            dir: false,
          })),
        })),
      },
      {
        name: "assemblies",
        path: `${root}/assemblies`,
        dir: true,
        children: assemblies.map((a) => ({
          name: a.ref,
          path: a.path,
          dir: false,
        })),
      },
    ],
  };
}

/** Every path under a READ-ONLY level, plus the level's own row — `@engine` and only it, a scanned plugin having no folder. */
export function readOnlyPaths(libraries: ModuleLibrary[]): Set<string> {
  const out = new Set<string>();
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      out.add(n.path);
      if (n.children) walk(n.children);
    }
  };
  for (const l of libraries)
    if (l.readOnly) {
      out.add(l.path || nsLabel(l.ns));
      walk(l.nodes);
    }
  return out;
}

/** The library ROOT a row belongs to, or null under a read-only level — what 'New folder…' and 'New module…' resolve against. */
export function rootOf(
  libraries: ModuleLibrary[],
  path: string,
): ModuleLibrary | null {
  return (
    libraries.find(
      (l) =>
        !l.readOnly &&
        l.path &&
        (path === l.path || path.startsWith(`${l.path}/`)),
    ) ?? null
  );
}

/** The ref a chain writes for one of a SHARED module's files — a FILE path always, so the last segment is the one to drop. */
export function libraryModuleRef(file: string): string | null {
  const parts = file.split("/").filter(Boolean);
  const at = parts.indexOf(LIBRARIES_DIR);
  if (at >= 0)
    return parts[at + 1] === "modules"
      ? refOf("st0", parts.slice(at + 2, -1))
      : null;
  const shared = parts.indexOf(SHARED_MODULES_DIR);
  return shared >= 0 ? refOf("workspace", parts.slice(shared + 1, -1)) : null;
}

/** `<type>/<sub>` under a level, or null when there is no module there to name. */
const refOf = (ns: string, segs: string[]): string | null =>
  segs.length >= 2 ? `${nsLabel(ns)}/${segs.join("/")}` : null;

/** Is this workspace path inside the ACCOUNT's library? Only `_libraries`; a `@workspace` module forks instead (packages/song/docs/moduleFork.md). */
export const isLibraryPath = (path: string): boolean =>
  path.split("/").includes(LIBRARIES_DIR);
