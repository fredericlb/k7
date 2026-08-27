// sharedFolders.ts — the shared `_modules/` and `_library/` a project sees, found by WHERE
// they are and nothing else: the workspace's own beside the project, then the machine's
// médiathèque. No project field declares them. Full rationale: docs/sharedFolders.md.

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

/** The three families the library repository carries — `library/` is not one, see docs/moduleAssets.md. */
export const librariesDirFor = (
  dir: string,
  kind: "modules" | "chains" | "assemblies",
) => resolve(dir, LIBRARIES_PATH, kind);

/** …and the same folder when `dir` is INSIDE the library already, which a template being edited is. */
export function librariesFamilyRoot(
  dir: string,
  kind: "modules" | "chains" | "assemblies",
): string | null {
  const root = librariesDirFor(dir, kind);
  if (existsSync(root)) return root;
  const abs = resolve(dir);
  const segs = abs.split(/[\\/]+/);
  const at = segs.lastIndexOf(LIBRARIES_DIR);
  if (at < 0) return null;
  // Walked UP rather than rejoined: a POSIX path splits to a leading "" that join() drops, answering a RELATIVE path.
  const inside = resolve(abs, ...Array(segs.length - 1 - at).fill(".."), kind);
  return existsSync(inside) ? inside : null;
}

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
  return librariesFamilyRoot(dir, "modules");
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
