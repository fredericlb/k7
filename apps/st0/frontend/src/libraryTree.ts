// libraryTree.ts — the LIBRARIES tab: one row per module level, its modules under it. The
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

/** The libraries as tree rows, one synthesised row per level, subtrees passed through UNTOUCHED — `@st0` is the one that disappears when absent. */
export function libraryTree(
  libraries: ModuleLibrary[],
  // The library's CHAINS, from the same repository and in the same tab — one LEAF row each, the builder being what opens a chain.
  chains: readonly { ref: string; path: string; nodes?: string[] }[] = [],
): FileNode[] {
  const levels = libraries
    .filter((l) => l.exists || l.ns !== "st0")
    .map((l) => ({
      name: nsLabel(l.ns),
      // The real path, workspace-relative like every other here; `@engine` has none, its label being all that identifies its row.
      path: l.path || nsLabel(l.ns),
      dir: true,
      children: l.nodes,
    }));
  if (!chains.length) return levels;
  // Last, and under a row of its own: a chain is not a module, and filing it under a module namespace would say it was one.
  return [
    ...levels,
    {
      name: CHAINS_LABEL,
      path: CHAINS_LABEL,
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
  ];
}

/** The row the library's chains hang under. A label, not a path — like `@engine`'s. */
export const CHAINS_LABEL = "@st0/chains";

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
