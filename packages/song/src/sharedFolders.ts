// sharedFolders.ts — the shared `_modules/` and `_library/` a project sees, found by WHERE
// they are and nothing else: the workspace's own beside the project, then the machine's
// médiathèque. `modules_from`/`libraries_from` used to declare them and no longer exist.
// Full rationale: docs/sharedFolders.md.

import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Where the shared modules folder sits, relative to a project (see module.populate). */
export const SHARED_MODULES_PATH = "../_modules";

// The folder name lives in moduleTypes.ts, where a BROWSER can read it; re-exported as one vocabulary.
export { SHARED_MODULES_DIR } from "@studio/song-schema/moduleTypes";

import { SHARED_MODULES_DIR } from "@studio/song-schema/moduleTypes";

// …and so does the library submodule's, for st0's file tree; re-exported as MODULE_NAMESPACES is.
export { LIBRARIES_DIR, LIBRARIES_PATH } from "@studio/song-schema/moduleTypes";

import { LIBRARIES_DIR, LIBRARIES_PATH } from "@studio/song-schema/moduleTypes";

/** The two families the library repository carries — `library/` is not one, see docs/moduleAssets.md. */
export const librariesDirFor = (dir: string, kind: "modules" | "chains") =>
  resolve(dir, LIBRARIES_PATH, kind);

/** Is this path inside a shared module library, by SEGMENT and either separator? See docs/moduleFork.md. */
export function isInSharedModules(path: string): boolean {
  return path.split(/[\\/]+/).some((seg) => seg === SHARED_MODULES_DIR);
}

/** Is there a shared module folder beside this project? Its level is `@workspace` because of where it sits. */
export function hasSharedModules(dir: string): boolean {
  return existsSync(join(dir, SHARED_MODULES_PATH));
}

/** The library repository's modules as mounted beside this project, or null — docs/sharedFolders.md. */
export function librariesModulesRoot(dir: string): string | null {
  const root = librariesDirFor(dir, "modules");
  if (existsSync(root)) return root;
  // …or `dir` is INSIDE the library repository already, which a chain template is — docs/sharedFolders.md.
  const segs = dir.split(/[\\/]+/);
  const at = segs.lastIndexOf(LIBRARIES_DIR);
  if (at < 0) return null;
  const inside = join(...segs.slice(0, at + 1), "modules");
  return existsSync(inside) ? inside : null;
}

/** Every shared module root this project inherits, nearest FIRST, none of them declared — docs/sharedFolders.md. */
export function moduleLibraryDirs(dir: string): string[] {
  const out: string[] = [];
  const shared = resolve(dir, SHARED_MODULES_PATH);
  if (existsSync(shared)) out.push(shared);
  const libs = librariesModulesRoot(dir);
  if (libs && !out.includes(libs)) out.push(libs);
  return out;
}

// The four levels live in moduleTypes.ts, which a browser may import and this file may not.
export {
  MODULE_NAMESPACES,
  type ModuleNamespace,
} from "@studio/song-schema/moduleTypes";

import type { ModuleNamespace } from "@studio/song-schema/moduleTypes";

/** The namespace a module root answers to, decided by the folder it SITS IN — docs/sharedFolders.md. */
export function moduleNamespaceOf(root: string): ModuleNamespace {
  return basename(dirname(resolve(root))) === LIBRARIES_DIR
    ? "st0"
    : "workspace";
}

/** Every module library this project can see, nearest first — panels included, docs/sharedFolders.md. */
export function modulePanelRoots(dir: string): string[] {
  const own = join(dir, "modules");
  const out = existsSync(own) ? [own] : [];
  for (const lib of moduleLibraryDirs(dir))
    if (!out.includes(lib)) out.push(lib);
  return out;
}

// There is no shared ASSET library: a module carries the files it loads (docs/moduleAssets.md).
