// sharedFolders.ts — the shared `_modules/` and `_library/` a project sees, found by WHERE
// they are and nothing else: the workspace's own beside the project, then the machine's
// médiathèque. `modules_from`/`libraries_from` used to declare them and no longer exist.
// Full rationale: docs/sharedFolders.md.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { mediatekDirFor } from "./mediatekRoot";

/** Where the shared modules folder sits, relative to a project (see module.populate). */
export const SHARED_MODULES_PATH = "../_modules";

/** The folder name a shared module library lives under, at the workspace root. */
export const SHARED_MODULES_DIR = "_modules";

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
 * The machine's media library, when it has one.
 *
 * `@mediatek` names a level whose folder is fixed. Stated once here; `moduleLibraryDirs` and
 * `loadModuleRefs` both read it, which is what keeps the modules, their panels and the
 * catalogue agreeing about what a project can reach. See docs/moduleNamespaces.md.
 */
export function mediatekModulesRoot(): string | null {
  const root = mediatekDirFor("modules");
  return existsSync(root) ? root : null;
}

/**
 * Every shared module root this project inherits: the workspace's own `_modules`, then the
 * médiathèque. Both are FIXED locations, which is why neither is declared.
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
  const media = mediatekModulesRoot();
  if (media && !out.includes(media)) out.push(media);
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
 */
export function moduleNamespaceOf(root: string): ModuleNamespace {
  return resolve(root) === mediatekDirFor("modules") ? "mediatek" : "workspace";
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
