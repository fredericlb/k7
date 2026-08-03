// sharedFolders.ts — wire a project to the workspace's shared `_modules/`/`_library/`
// folders (declared in project.yaml's `modules_from`/`libraries_from` lists).
// The folder must exist first — loadModuleRefs throws on an unresolvable path — so
// every function here checks and no-ops rather than writing a speculative reference.
// Full rationale: docs/sharedFolders.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isSeq, parseDocument } from "yaml";
import { MEDIATEK_REF, mediatekRoot, resolveMediatekRef } from "./mediatekRoot";
import { entityFileFor } from "./yaml/moduleIO";

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

/** Is there a shared module folder beside this project? The folder alone answers it now:
 *  its level is `@workspace` because of where it sits, not because it says so. */
export function hasSharedModules(dir: string): boolean {
  return existsSync(join(dir, SHARED_MODULES_PATH));
}

/** The paths `project.modules_from` already lists, as written (no resolution). */
function declared(doc: ReturnType<typeof parseDocument>): string[] {
  // Reads the raw document, not the compiled project — this runs during scaffold, before there's a project to compile.
  const list = doc.getIn(["project", "modules_from"]);
  if (!isSeq(list)) return [];
  return list.items
    .map((i) => String((i as { value?: unknown })?.value ?? i))
    .filter(Boolean);
}

/**
 * The machine's media library, when it has one — the root every project sees WITHOUT
 * declaring it.
 *
 * `@mediatek` names a level whose folder is fixed, so a project listing it in
 * `modules_from` stated something the loader already knew, and a project written before
 * the scaffold added that line saw nothing at all. Stated once here; `moduleLibraryDirs`
 * and `loadModuleRefs` both read it, which is what keeps the modules, their panels and the
 * catalogue agreeing about what this project can reach. See docs/moduleNamespaces.md.
 */
export function mediatekModulesRoot(): string | null {
  const root = join(mediatekRoot(), "modules");
  return existsSync(root) ? root : null;
}

/** `project.modules_from` resolved against the project dir, absolute entries kept as-is —
 *  the same rule loader.ts applies — followed by the médiathèque, which needs no declaring. */
export function moduleLibraryDirs(dir: string): string[] {
  const path = join(dir, "project.yaml");
  if (!existsSync(path)) return [];
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(readFileSync(path, "utf8"), { version: "1.2" });
  } catch {
    return []; // an unparseable header is the compiler's problem to report, not ours
  }
  const out = declared(doc)
    // Normalised, absolute entries included — see libraryDirs for the containment check that depends on it.
    .map((p) =>
      resolve(
        resolveMediatekRef(p, "modules") ??
          (isAbsolute(p) ? p : resolve(dir, p)),
      ),
    )
    .filter((abs) => existsSync(abs));
  // LAST, so a workspace folder the project named itself keeps precedence over the ambient one.
  const media = mediatekModulesRoot();
  if (media && !out.includes(media)) out.push(media);
  return out;
}

/**
 * The four levels a module can live at, outermost first. A ref carries the level as its
 * `@` prefix — `@engine/audio/nam`, `@mediatek/…`, `@workspace/…`, `@project/…` — and a
 * BARE ref (`audio/reverb`) is the project level written the short way.
 *
 * `engine` is the odd one: it names no folder at all. A scanned plugin is synthesised by
 * `engineCatalogue` from the machine's scan cache, so it is a level without a root.
 */
export const MODULE_NAMESPACES = [
  "engine",
  "mediatek",
  "workspace",
  "project",
] as const;
export type ModuleNamespace = (typeof MODULE_NAMESPACES)[number];

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
 * those are the only two roots `modules_from` can name.
 */
export function moduleNamespaceOf(root: string): ModuleNamespace {
  return resolve(root) === join(mediatekRoot(), "modules")
    ? "mediatek"
    : "workspace";
}

/**
 * Every module library this project can see, nearest first — its own `modules/`, then the ones
 * `modules_from` names.
 *
 * These are also the roots a PANEL is looked for under, because a panel is the `ui.yaml` in its
 * module's own folder: there is no separate UI tree to declare, and pointing a project at a library
 * brings the faces along with nothing else to write down. Order is PRECEDENCE — see loadUiLibrary.
 */
export function modulePanelRoots(dir: string): string[] {
  const own = join(dir, "modules");
  const out = existsSync(own) ? [own] : [];
  for (const lib of moduleLibraryDirs(dir))
    if (!out.includes(lib)) out.push(lib);
  return out;
}

/** Append one entry to `project.modules_from`, keeping what is there. Returns true when project.yaml was rewritten. */
function addModulesFrom(dir: string, entry: string): boolean {
  const path = join(dir, "project.yaml");
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text, { version: "1.2" });
  const paths = declared(doc);
  if (paths.includes(entry)) return false;
  const list = doc.createNode([...paths, entry]);
  list.flow = true; // one short line, as the scaffold writes it
  doc.setIn(["project", "modules_from"], list);
  const next = doc.toString({ lineWidth: 0 });
  if (next === text) return false;
  writeFileSync(path, next, "utf8");
  return true;
}

/** Ensure `project.modules_from` lists the workspace's own shared folder. */
export function ensureSharedModules(dir: string): boolean {
  if (!hasSharedModules(dir)) return false;
  return addModulesFrom(dir, SHARED_MODULES_PATH);
}

/**
 * Ensure `project.modules_from` names the machine's media library.
 *
 * Written as the `@mediatek` TOKEN, never as the path it resolves to: `project.yaml` is
 * committed, so an absolute path would break on the next machine and put someone's home
 * directory in a shared repo. Same reason the modules themselves are referenced by
 * namespace rather than by location.
 *
 * A no-op when there is no library on this machine — the loader THROWS on a `modules_from`
 * it can't resolve, so writing the reference speculatively would turn a working project
 * into one that won't load. That is the rule every function in this file follows.
 */
export function ensureMediatekModules(dir: string): boolean {
  const resolved = resolveMediatekRef(MEDIATEK_REF, "modules");
  if (!resolved || !existsSync(resolved)) return false;
  return addModulesFrom(dir, MEDIATEK_REF);
}

// --- the asset library -------------------------------------------------------

/** Where the shared asset library sits, relative to a project — the sibling of the
 *  projects, like `_modules/`. */
export const SHARED_LIBRARY_PATH = "../_library";

/** Is there a shared library beside this project? No config needed — a library is just folders of files (see loader.ts libraryDirs). */
export function hasSharedLibrary(dir: string): boolean {
  return existsSync(join(dir, SHARED_LIBRARY_PATH));
}

/** Ensure `project.libraries_from` includes the shared library (appended; migrates the old singular `library_from`). Returns true when project.yaml was rewritten. */
export function ensureSharedLibrary(dir: string): boolean {
  if (!hasSharedLibrary(dir)) return false;
  const path = join(dir, "project.yaml");
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text, { version: "1.2" });

  const existing = doc.getIn(["project", "libraries_from"]);
  const list: string[] = Array.isArray(
    (existing as { toJSON?: () => unknown })?.toJSON?.(),
  )
    ? ((existing as { toJSON: () => string[] }).toJSON() ?? [])
    : [];
  const legacy = doc.getIn(["project", "library_from"]); // pre-list field, migrated then removed
  if (typeof legacy === "string" && legacy && !list.includes(legacy))
    list.push(legacy);
  doc.deleteIn(["project", "library_from"]);

  if (!list.includes(SHARED_LIBRARY_PATH)) list.push(SHARED_LIBRARY_PATH);
  doc.setIn(["project", "libraries_from"], list);
  const next = doc.toString({ lineWidth: 0 });
  if (next === text) return false;
  writeFileSync(path, next, "utf8");
  return true;
}
