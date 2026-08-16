// libraryTree.ts — the LIBRARIES tab: one row per module level, its modules under it. The
// levels come from the file service (`GET /module-libraries`), which reads the same roots the
// LOADER resolves against — they sit outside the active project, so the file tree does not and
// must not contain them. Why the tab exists: apps/l8/frontend/docs/sharedModules.md.

import { LIBRARIES_DIR, SHARED_MODULES_DIR } from "@studio/song/moduleTypes";
import type { FileNode, ModuleLibrary } from "@studio/web-protocol";

/** How a level is written wherever a person reads one: in a ref, and on a tree row. */
export const nsLabel = (ns: string): string => `@${ns}`;

/**
 * The libraries as tree rows, one synthesised row per level.
 *
 * Synthesised because the shared tree draws no row for its own root (`rootLabel` is a label and
 * nothing else), and the row is the one thing that says WHICH library you are looking at. The
 * subtrees are passed through UNTOUCHED — l8's `foldModules` is what turns a module folder into
 * a single row, the same fold the Project tab uses, so the two cannot draw a module differently.
 *
 * A level with no folder yet is still drawn, empty. It is a place you can put a module — the
 * row's menu offers exactly that — and hiding it would leave nowhere to start from on a project
 * whose `modules/` does not exist yet, which is every new project.
 *
 * `@st0` is the one level that disappears when absent: it is a git submodule somebody has to
 * mount, not a folder to fill in, so an empty row would be an offer nothing here can honour.
 */
export function libraryTree(
  libraries: ModuleLibrary[],
  // The library's CHAINS, which come from the same repository the shared modules do and belong
  // in the same tab. One LEAF row each rather than a folder to open: a chain is a folder on disk
  // (a `graph.yaml` and a `nodes/`), but what you want from this tab is the chain, and the
  // builder is what opens it — the same promise a module row makes.
  chains: readonly { ref: string; path: string; nodes?: string[] }[] = [],
): FileNode[] {
  const levels = libraries
    .filter((l) => l.exists || l.ns !== "st0")
    .map((l) => ({
      name: nsLabel(l.ns),
      // The real path, so every row under it — and every read, write and create — addresses
      // what is actually there. Workspace-relative, like every other path in this app.
      // `@engine` has none: its own label is the only thing that identifies its row.
      path: l.path || nsLabel(l.ns),
      dir: true,
      children: l.nodes,
    }));
  if (!chains.length) return levels;
  // Last, and under a row of its own: a chain is not a module, and filing it under a module
  // namespace would say it was one. The label is the vocabulary a `clip process` uses.
  return [
    ...levels,
    {
      name: CHAINS_LABEL,
      path: CHAINS_LABEL,
      dir: true,
      // A chain OPENS, and its nodes are under it — a chain is a folder holding a graph and the
      // nodes it names, and the tree says so rather than hiding half of it. A chain with none is
      // still a folder: it is one node away from having some, and a leaf row would say otherwise.
      children: chains.map((c) => ({
        name: c.ref,
        path: c.path,
        dir: true,
        children: (c.nodes ?? []).map((n) => ({
          name: n,
          // The real path, like every other row here — it is what tells this node's row from
          // its chain's when one is clicked.
          path: `${c.path}/nodes/${n}`,
          dir: false,
        })),
      })),
    },
  ];
}

/** The row the library's chains hang under. A label, not a path — like `@engine`'s. */
export const CHAINS_LABEL = "@st0/chains";

/**
 * Every path under a READ-ONLY level, plus the level's own row.
 *
 * `@engine` and only it: a scanned plugin has no folder, so there is nothing to open, create,
 * rename or write. The rows are a vocabulary a chain can name — the tab greys them and offers
 * no menu, which is the honest drawing of "this exists but is not a file".
 */
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

/** The library ROOT a row belongs to, or null for a row under a read-only level or none.
 *  What "New folder…" and "New module…" resolve their target against. */
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
    return parts[at + 1] === "modules"
      ? refOf("st0", parts.slice(at + 2, -1))
      : null;
  const shared = parts.indexOf(SHARED_MODULES_DIR);
  return shared >= 0 ? refOf("workspace", parts.slice(shared + 1, -1)) : null;
}

/** `<type>/<sub>` under a level, or null when there is no module there to name. */
const refOf = (ns: string, segs: string[]): string | null =>
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
