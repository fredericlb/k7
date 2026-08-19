// sharedFolders.ts — the shared `_modules/` and `_library/` a project sees, found by WHERE
// they are and nothing else: the workspace's own beside the project, then the machine's
// médiathèque. `modules_from`/`libraries_from` used to declare them and no longer exist.
// Full rationale: docs/sharedFolders.md.

import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Where the shared modules folder sits, relative to a project (see module.populate). */
export const SHARED_MODULES_PATH = "../_modules";

// The folder name a shared module library lives under, at the workspace root, is in
// moduleTypes.ts — a browser names it too. Re-exported so the vocabulary reads as one place.
export { SHARED_MODULES_DIR } from "./moduleTypes";

import { SHARED_MODULES_DIR } from "./moduleTypes";

// Where the library submodule sits is in moduleTypes.ts, which opens no `node:` module — l8's
// file tree names that folder to keep it off the Project tab. Re-exported so the vocabulary
// still reads as one place, exactly as MODULE_NAMESPACES is.
export { LIBRARIES_DIR, LIBRARIES_PATH } from "./moduleTypes";

import { LIBRARIES_DIR, LIBRARIES_PATH } from "./moduleTypes";

/** The two families the library repository carries. `library/` is not one — a module holds the
 *  files it loads in its own `assets/` (see docs/moduleAssets.md). */
export const librariesDirFor = (dir: string, kind: "modules" | "chains") =>
  resolve(dir, LIBRARIES_PATH, kind);

/** Is this path inside a shared module library? Those are READ-ONLY — see docs/moduleFork.md.
 *  Matched on a path SEGMENT (a project called "my_modules" is not one), either separator, since callers pass
 *  workspace-relative paths from a browser and absolute ones from node. */
export function isInSharedModules(path: string): boolean {
  return path.split(/[\\/]+/).some((seg) => seg === SHARED_MODULES_DIR);
}

/** Is there a shared module folder beside this project? The folder alone answers it:
 *  its level is `@workspace` because of where it sits, not because it says so. */
export function hasSharedModules(dir: string): boolean {
  return existsSync(join(dir, SHARED_MODULES_PATH));
}

/**
 * The library repository's modules, as mounted beside this project — or null when the
 * submodule is not there.
 *
 * `@st0` names a level whose folder is fixed. Stated once here; `moduleLibraryDirs` and
 * `loadModuleRefs` both read it, which is what keeps the modules, their panels and the
 * catalogue agreeing about what a project can reach. See docs/moduleNamespaces.md.
 *
 * It used to be `~/.studio/mediatek/modules` — one folder per MACHINE, synced from the hosted
 * médiathèque. It is one per WORKSPACE now, and it is a git checkout: what a project inherits
 * travels with the repository it is cloned from, and an edit to a shared module is a commit
 * somebody can read rather than a file that appeared. The cache is still there, and still what
 * songs and samples are played from; it just no longer answers for modules.
 */
export function librariesModulesRoot(dir: string): string | null {
  const root = librariesDirFor(dir, "modules");
  if (existsSync(root)) return root;
  // …or `dir` is INSIDE the library repository already — a chain template, whose nodes name
  // `@st0/…` modules living two folders up in the same repo. `../_libraries` resolves to nothing
  // from there, so a chain loaded on its own saw NO catalogue at all and drew every node as a
  // missing plugin.
  //
  // Still a fixed location, which is the rule this file exists to keep: `_libraries` is a folder
  // NAME, not a declaration, and finding the one you are standing in is the same layout read from
  // within. Nothing here is a search — the segment either is on the path or it is not.
  const segs = dir.split(/[\\/]+/);
  const at = segs.lastIndexOf(LIBRARIES_DIR);
  if (at < 0) return null;
  const inside = join(...segs.slice(0, at + 1), "modules");
  return existsSync(inside) ? inside : null;
}

/**
 * Every shared module root this project inherits: the workspace's own `_modules`, then the
 * library submodule beside it. Both are FIXED locations, which is why neither is declared.
 *
 * `project.modules_from` used to list them, and the list could only ever hold those same two
 * things — so it decided nothing, while giving every project a way to be wrong about facts
 * the loader already knew. Three ways, in practice, all seen on one afternoon: a project
 * older than the line saw no médiathèque at all; a folder deleted from the workspace left a
 * declaration behind that took the whole song down; and the same paths written twice drifted
 * apart between the compiler and the builder's catalogue.
 *
 * Order is PRECEDENCE, nearest first — see loadUiLibrary.
 */
export function moduleLibraryDirs(dir: string): string[] {
  const out: string[] = [];
  const shared = resolve(dir, SHARED_MODULES_PATH);
  if (existsSync(shared)) out.push(shared);
  const libs = librariesModulesRoot(dir);
  if (libs && !out.includes(libs)) out.push(libs);
  return out;
}

// The four levels themselves live in moduleTypes.ts, which opens no `node:` module: a browser
// asks what a namespace is called (l8's Libraries tab does), and this file cannot be imported
// there — it reads the disk on the very first line. Re-exported so the vocabulary still reads
// as one place. Same argument as `moduleKeyFromPath`'s.
export { MODULE_NAMESPACES, type ModuleNamespace } from "./moduleTypes";

import type { ModuleNamespace } from "./moduleTypes";

/**
 * The namespace a module root answers to, decided by WHERE it is and nothing else.
 *
 * It used to be declared, per root, in that root's `config.yaml`. That made the level a
 * free string an author chose, with two consequences worth stating: a workspace library
 * could call itself `engine` and collide head-on with the synthesised catalogue (a dozen
 * fixtures in this repo did exactly that), and nothing tied the name to how deep the
 * folder actually sat. The levels are structural now — inheritance is what expresses
 * "the same module, adjusted here" (see docs/moduleNamespaces.md) — so the declaration
 * had nothing left to decide and is gone.
 *
 * Anything that is not the machine's media library is the workspace's own `_modules`:
 * those are the only two shared roots there are.
 *
 * The library repository answers to `@st0`, after the app that registered it when the level was
 * named. It was `@mediatek` before that, while the app was `apps/mediatek` — see
 * scripts/migrateNamespace.ts. That app is **pl8** today and this level stayed `st0` on
 * purpose: a level is written into user files, and moving it a second time would cost every
 * repository a rewrite for a name nobody types. See moduleTypes.ts' MODULE_NAMESPACES.
 *
 * Recognised by the folder it SITS IN (`_libraries/modules`) rather than by an absolute path,
 * which is what it used to be: the médiathèque's modules lived at one place per machine, and
 * the test was an exact string equality against it. There is one per workspace now, so there
 * is no single path to compare with — and the structural test is the better one anyway, being
 * the same kind of answer `@workspace` has always given.
 */
export function moduleNamespaceOf(root: string): ModuleNamespace {
  return basename(dirname(resolve(root))) === LIBRARIES_DIR
    ? "st0"
    : "workspace";
}

/**
 * Every module library this project can see, nearest first — its own `modules/`, then the
 * shared roots.
 *
 * These are also the roots a PANEL is looked for under, because a panel is the `ui.yaml` in its
 * module's own folder: there is no separate UI tree to declare, and a library brings the faces
 * along with nothing else to write down. Order is PRECEDENCE — see loadUiLibrary.
 */
export function modulePanelRoots(dir: string): string[] {
  const own = join(dir, "modules");
  const out = existsSync(own) ? [own] : [];
  for (const lib of moduleLibraryDirs(dir))
    if (!out.includes(lib)) out.push(lib);
  return out;
}

// There is no shared ASSET library any more. A file a plugin loads — a .nam model — lives in
// the `assets/` folder of the module that names it, so the module is self-contained and travels
// whole. See loader.ts's resolveModuleAsset and docs/moduleAssets.md.
