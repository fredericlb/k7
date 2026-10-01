// sharedFolders.ts — the shared module folders a project sees, found by WHERE they are and
// nothing else: the workspace's own `_modules/` beside the project, then every library the file
// service cloned under `<studioHome>/libraries/`. No project field declares them. Full
// rationale: docs/sharedFolders.md.

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { studioHome } from "./studioHome";

/** Where the shared modules folder sits, relative to a project (see module.populate). */
export const SHARED_MODULES_PATH = "../_modules";

// The folder name lives in moduleTypes.ts, where a BROWSER can read it; re-exported as one vocabulary.
export { SHARED_MODULES_DIR } from "@studio/song-schema/moduleTypes";

import { SHARED_MODULES_DIR } from "@studio/song-schema/moduleTypes";

// …and so do the libraries' folder names, for st0's file tree; re-exported as one vocabulary.
export {
  DEFAULT_LIBRARY,
  isLibraryName,
  LIBRARIES_DIR,
  LIBRARIES_HOME_DIR,
} from "@studio/song-schema/moduleTypes";

import {
  isLibraryName,
  LIBRARIES_HOME_DIR,
} from "@studio/song-schema/moduleTypes";

/** The families a library repository carries — `library/` is not one, see docs/moduleAssets.md and docs/libraryFiles.md. */
export type LibraryFamily =
  | "modules"
  | "chains"
  | "assemblies"
  | "samples"
  | "irs"
  | "models";

/** Where the file service clones the account's libraries: `<studioHome>/libraries` — docs/sharedFolders.md. */
export const librariesHome = (): string =>
  join(studioHome(), LIBRARIES_HOME_DIR);

/** One of the account's libraries: its name, which is its ref's namespace, and its checkout. */
export interface AccountLibrary {
  name: string;
  root: string;
}

/** Every library cloned on this machine, by NAME order — found by where they are, never declared (docs/sharedFolders.md). */
export function accountLibraries(): AccountLibrary[] {
  const home = librariesHome();
  let names: string[];
  try {
    names = readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isLibraryName(e.name))
      .map((e) => e.name);
  } catch {
    return []; // no libraries yet — the ordinary state of a new machine
  }
  return names.sort().map((name) => ({ name, root: join(home, name) }));
}

/** One family of every library, those that have it: each library's `chains/`, say. */
export function libraryFamilyRoots(kind: LibraryFamily): AccountLibrary[] {
  return accountLibraries()
    .map((l) => ({ name: l.name, root: join(l.root, kind) }))
    .filter((l) => existsSync(l.root));
}

/** The library `path` lies in, or null — a template being edited stands INSIDE one. */
export function libraryOf(path: string): AccountLibrary | null {
  const rel = relative(librariesHome(), resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const name = rel.split(/[\\/]+/)[0];
  return isLibraryName(name)
    ? { name, root: join(librariesHome(), name) }
    : null;
}

/** One library's family folder, or null when that library is not here or carries none of it. */
export function libraryFamilyRoot(
  library: string,
  kind: LibraryFamily,
): string | null {
  if (!isLibraryName(library)) return null;
  const root = join(librariesHome(), library, kind);
  return existsSync(root) ? root : null;
}

/** Is this path inside a shared module library, by SEGMENT and either separator? See docs/moduleFork.md. */
export function isInSharedModules(path: string): boolean {
  return path.split(/[\\/]+/).some((seg) => seg === SHARED_MODULES_DIR);
}

/** Is there a shared module folder beside this project? Its level is `@workspace` because of where it sits. */
export function hasSharedModules(dir: string): boolean {
  return existsSync(join(dir, SHARED_MODULES_PATH));
}

/** Every shared module root this project inherits, nearest FIRST, none of them declared — docs/sharedFolders.md. */
export function moduleLibraryDirs(dir: string): string[] {
  const out: string[] = [];
  const shared = resolve(dir, SHARED_MODULES_PATH);
  if (existsSync(shared)) out.push(shared);
  for (const l of libraryFamilyRoots("modules"))
    if (!out.includes(l.root)) out.push(l.root);
  return out;
}

// The fixed levels live in moduleTypes.ts, which a browser may import and this file may not.
export {
  FIXED_NAMESPACES,
  type ModuleNamespace,
} from "@studio/song-schema/moduleTypes";

import type { ModuleNamespace } from "@studio/song-schema/moduleTypes";

/** st0's OWN modules, shipped with its code and read like a library under `@meta` — docs/metaModules.md. */
export const META_MODULES_ROOT = fileURLToPath(
  new URL("../meta", import.meta.url),
);

/** The namespace a module root answers to, decided by WHERE it is: `meta`, a library's name, else `workspace` — docs/sharedFolders.md. */
export function moduleNamespaceOf(root: string): ModuleNamespace {
  if (resolve(root) === META_MODULES_ROOT) return "meta";
  return libraryOf(root)?.name ?? "workspace";
}

/** Every module library this project can see, nearest first — panels included, docs/sharedFolders.md. */
export function modulePanelRoots(dir: string): string[] {
  // `@meta` last: read like a library, but never one an author edits, forks into or lists (docs/metaModules.md).
  return [...moduleLibraryDirs(dir), META_MODULES_ROOT];
}

// There is no shared ASSET library: a module carries the files it loads (docs/moduleAssets.md).
