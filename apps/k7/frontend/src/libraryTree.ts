// libraryTree.ts — the LIBRARIES tab: one row per module level, its modules under it, and each of
// the account's library repositories as one row with its three families. The
// levels come from the file service (`GET /module-libraries`), which reads the same roots the
// LOADER resolves against — they sit outside the active project, so the file tree does not and
// must not contain them. Why the tab exists: apps/k7/frontend/docs/sharedModules.md.

import { isDocFile } from "@studio/song-schema/docExt";
import {
  FIXED_NAMESPACES,
  isLibraryName,
  LIBRARIES_DIR,
  type LibraryFileFamily,
  SHARED_MODULES_DIR,
} from "@studio/song-schema/moduleTypes";
import type { FileNode, ModuleLibrary } from "@studio/web-protocol";

/** How a level is written wherever a person reads one: in a ref, and on a tree row. */
const nsLabel = (ns: string): string => `@${ns}`;

/** A library chain, as the tab lists it: `ref` is `@<library>/<path under chains/>`, `path` its file or a folder chain's folder. */
export interface LibraryChainRow {
  ref: string;
  path: string;
  /** A FOLDER chain's node files; a chain file holds its nodes, so none. */
  nodes?: string[];
}

/** A chain kept as ONE file — the format; a folder chain is one a library clone has not migrated yet. */
export const isChainFile = isDocFile;

/** An assembly template of the library: `path` its folder, `file` the `assembly.k7x` the builder opens. */
export interface LibraryAssemblyRow {
  ref: string;
  path: string;
  file: string;
}

/** Is this level one of the account's LIBRARIES, rather than `@workspace` or `@engine`? */
const isRepository = (ns: string): boolean =>
  !(FIXED_NAMESPACES as readonly string[]).includes(ns);

/**
 * The libraries as tree rows. `@workspace` and `@engine` are module LEVELS, one row each with their
 * modules under it. Every other level is one of the account's library REPOSITORIES, and it is drawn
 * as one — its three families side by side as they are on disk, `modules/` (the `@<name>` module
 * level), `chains/` and `assemblies/`. Drawing `modules/` AS `@k7-core` and the chains beside it as
 * `@k7-core/chains` made two siblings read as a folder and its child.
 */
export function libraryTree(
  libraries: ModuleLibrary[],
  // The libraries' CHAINS, by `@<library>/…` ref — each filed under its own library's row.
  chains: readonly LibraryChainRow[] = [],
  // …and their ASSEMBLY templates, the third family — one leaf each, the assembly builder being what opens one.
  assemblies: readonly LibraryAssemblyRow[] = [],
): FileNode[] {
  return libraries.map((l) =>
    isRepository(l.ns)
      ? repositoryRow(
          l,
          chains.filter((c) => c.ref.startsWith(`${nsLabel(l.ns)}/`)),
          assemblies.filter((a) => a.ref.startsWith(`${nsLabel(l.ns)}/`)),
        )
      : {
          name: nsLabel(l.ns),
          // The real path, workspace-relative like every other here; `@engine` has none, its label being all that identifies its row.
          path: l.path || nsLabel(l.ns),
          dir: true,
          children: l.nodes,
        },
  );
}

/** The repository's own folder: a library's module level is always its `modules/`, so its parent. */
function repositoryPath(l: ModuleLibrary): string {
  const at = l.path.lastIndexOf("/");
  return at > 0 ? l.path.slice(0, at) : `${LIBRARIES_DIR}/${l.ns}`;
}

/** A ref as its library's row shows it: the `@<library>/` is the row it sits under. */
const withinLibrary = (ns: string, ref: string): string =>
  ref.startsWith(`${nsLabel(ns)}/`) ? ref.slice(nsLabel(ns).length + 1) : ref;

function repositoryRow(
  l: ModuleLibrary,
  chains: readonly LibraryChainRow[],
  assemblies: readonly LibraryAssemblyRow[],
): FileNode {
  const root = repositoryPath(l);
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
        // A chain file is a leaf; a folder chain OPENS, its node files under it, even with none yet.
        children: chains.map((c) =>
          isChainFile(c.path)
            ? { name: withinLibrary(l.ns, c.ref), path: c.path, dir: false }
            : {
                name: withinLibrary(l.ns, c.ref),
                path: c.path,
                dir: true,
                children: (c.nodes ?? []).map((n) => ({
                  name: n,
                  // The real path, like every other row here — what tells this node's row from its chain's when one is clicked.
                  path: `${c.path}/nodes/${n}`,
                  dir: false,
                })),
              },
        ),
      },
      {
        name: "assemblies",
        path: `${root}/assemblies`,
        dir: true,
        children: assemblies.map((a) => ({
          name: withinLibrary(l.ns, a.ref),
          path: a.path,
          dir: false,
        })),
      },
      // The library's shared SOUNDS: what a rack tap and a cabinet pick from, and where a dropped file lands.
      {
        name: "samples",
        path: `${root}/samples`,
        dir: true,
        children: l.samples ?? [],
      },
      { name: "irs", path: `${root}/irs`, dir: true, children: l.irs ?? [] },
      // …the tables a wavetable instrument reads, beside the sounds since they are sounds too.
      {
        name: "wavetables",
        path: `${root}/wavetables`,
        dir: true,
        children: l.wavetables ?? [],
      },
      // …and its amp MODELS, which an amp's `model` picks as it picks its own assets.
      {
        name: "models",
        path: `${root}/models`,
        dir: true,
        children: l.models ?? [],
      },
    ],
  };
}

/** Which of a library's FILE folders this row is or lies in — `samples/`, `irs/`, `wavetables/`, `models/` — the only places a drop goes. */
export function fileFolderOf(path: string): LibraryFileFamily | null {
  const m = new RegExp(
    `^${LIBRARIES_DIR}/[^/]+/(samples|irs|wavetables|models)(/|$)`,
  ).exec(path);
  return m ? (m[1] as LibraryFileFamily) : null;
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
  if (at >= 0) {
    const name = parts[at + 1] ?? "";
    return isLibraryName(name) && parts[at + 2] === "modules"
      ? refOf(name, parts.slice(at + 3, -1))
      : null;
  }
  const shared = parts.indexOf(SHARED_MODULES_DIR);
  return shared >= 0 ? refOf("workspace", parts.slice(shared + 1, -1)) : null;
}

/** `<type>/<sub>` under a level, or null when there is no module there to name. */
const refOf = (ns: string, segs: string[]): string | null =>
  segs.length >= 2 ? `${nsLabel(ns)}/${segs.join("/")}` : null;

/** Is this workspace path inside one of the ACCOUNT's libraries? Only `_libraries/…`; a `@workspace` module forks instead (packages/song/docs/moduleFork.md). */
export const isLibraryPath = (path: string): boolean =>
  path.split("/").includes(LIBRARIES_DIR);

/** WHICH library a `_libraries/<name>/…` path is in — the one a Save publishes — or null. */
export function libraryOfPath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const at = parts.indexOf(LIBRARIES_DIR);
  const name = at >= 0 ? (parts[at + 1] ?? "") : "";
  return isLibraryName(name) ? name : null;
}
