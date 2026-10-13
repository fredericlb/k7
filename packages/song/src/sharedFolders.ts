// sharedFolders.ts — the shared module folders a project sees, found by WHERE they are and
// nothing else: the workspace's own `_modules/` beside the project, then every library the file
// hub holds, each at the version the workspace pins. For an admin, a library is OVERLAID: its
// draft marked writable. A published version is never written. No project field declares them.
// Full rationale: docs/sharedFolders.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  DRAFT_VERSION,
  LIBRARY_LEVEL,
  LIBRARY_MANIFEST,
  LIBRARY_PINS_FILE,
  type LibraryManifest,
  type LibraryPins,
  type LibraryVersion,
  parseLibraryManifest,
  parseLibraryPins,
  UNPINNED_VERSION,
  versionOfDir,
} from "@studio/song-schema/libraryVersions";
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
  | "wavetables"
  | "models";

/** Where the libraries are read from: the file hub's ONE folder of each (`$STUDIO_LIBRARIES_HOME`), else `<studioHome>/libraries` — docs/sharedFolders.md. */
export function librariesHome(): string {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the file hub, never under turbo
  const shared = process.env.STUDIO_LIBRARIES_HOME;
  return shared ? resolve(shared) : join(studioHome(), LIBRARIES_HOME_DIR);
}

/** A library's own folder: its published versions and its draft, or the whole library while it is still one folder. */
export const libraryHomeOf = (name: string): string =>
  join(librariesHome(), name);

/** The version folders of library `name` on this machine. */
function versionDirs(name: string): LibraryVersion[] {
  try {
    return readdirSync(libraryHomeOf(name), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => versionOfDir(e.name))
      .filter((v): v is LibraryVersion => v !== null);
  } catch {
    return [];
  }
}

/** Is library `name` laid out as versions? One still in a single folder is its own version 1 — docs/library-versions-plan.md. */
export const isVersionedLibrary = (name: string): boolean =>
  versionDirs(name).length > 0;

/** The PUBLISHED versions of library `name` here, oldest first; a library still in one folder answers [1]. */
export function libraryVersions(name: string): number[] {
  if (!existsSync(libraryHomeOf(name))) return [];
  const dirs = versionDirs(name);
  if (!dirs.length) return [UNPINNED_VERSION];
  return dirs
    .filter((v): v is number => v !== DRAFT_VERSION)
    .sort((a, b) => a - b);
}

/** What published version `v` of library `name` says about itself, or null when it carries no manifest. */
export function libraryManifest(
  name: string,
  v: number,
): LibraryManifest | null {
  try {
    return parseLibraryManifest(
      readFileSync(join(libraryVersionRoot(name, v), LIBRARY_MANIFEST), "utf8"),
    );
  } catch {
    return null;
  }
}

/** The newest published version of `name` a st0 at `level` runs; a version with no manifest asks for nothing. */
export function newestRunnableVersion(
  name: string,
  level = LIBRARY_LEVEL,
): number {
  const runnable = libraryVersions(name).filter(
    (v) => (libraryManifest(name, v)?.requires ?? 1) <= level,
  );
  return runnable.length ? runnable[runnable.length - 1] : UNPINNED_VERSION;
}

/** The folder version `v` of library `name` is read from; a library still in one folder is every version of itself. */
export function libraryVersionRoot(name: string, v: LibraryVersion): string {
  const home = libraryHomeOf(name);
  return isVersionedLibrary(name) ? join(home, String(v)) : home;
}

/** The pins of the workspace `from` stands in: the nearest `_library-pins.yaml` above it, else none. */
export function workspacePins(from: string): LibraryPins {
  let dir = resolve(from);
  for (;;) {
    const file = join(dir, LIBRARY_PINS_FILE);
    if (existsSync(file)) {
      try {
        return parseLibraryPins(readFileSync(file, "utf8"));
      } catch {
        return {};
      }
    }
    const up = dirname(dir);
    if (up === dir) return {};
    dir = up;
  }
}

/** The libraries this account may write, by name, and the folder each is read from. */
const overlays = new Map<string, string>();

/** Make each listed library writable, read from its `root`; every other is read-only from the shared folder — docs/sharedFolders.md. */
export function setLibraryOverlays(
  list: { name: string; root: string }[],
): void {
  overlays.clear();
  for (const l of list) overlays.set(l.name, resolve(l.root));
}

/** The libraries this account edits — the only ones any write may reach. */
export const libraryOverlays = (): { name: string; root: string }[] =>
  [...overlays].map(([name, root]) => ({ name, root }));

/** Whether this account edits library `name` at all — through its overlay, never a published version. */
export const isLibraryEditable = (name: string): boolean => overlays.has(name);

/** Whether the folder `lib` was read from is the one this account writes: a published version never is. */
export const isLibraryRootEditable = (lib: AccountLibrary): boolean =>
  overlays.get(lib.name) === resolve(lib.root);

/** Where library `name` is read from for the workspace `from` stands in: its pin, else an admin's overlay, else UNPINNED_VERSION. */
export function libraryRoot(name: string, from?: string): string {
  // Standing inside a version of this library, that version: a module reads its own library's files where it was loaded.
  const own = from ? libraryOf(from) : null;
  if (own?.name === name && own.root !== libraryHomeOf(name)) return own.root;
  const pins = from ? workspacePins(from) : {};
  if (name in pins) return libraryVersionRoot(name, pins[name]);
  return overlays.get(name) ?? libraryVersionRoot(name, UNPINNED_VERSION);
}

/** One of the account's libraries: its name, which is its ref's namespace, and the folder it is read from. */
export interface AccountLibrary {
  name: string;
  root: string;
}

/** Every library on this machine, by NAME order, each at the version `from`'s workspace pins — docs/sharedFolders.md. */
export function accountLibraries(from?: string): AccountLibrary[] {
  let names: string[];
  try {
    names = readdirSync(librariesHome(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && isLibraryName(e.name))
      .map((e) => e.name);
  } catch {
    names = []; // no libraries yet — the ordinary state of a new machine
  }
  for (const name of overlays.keys())
    if (!names.includes(name)) names.push(name);
  return names.sort().map((name) => ({ name, root: libraryRoot(name, from) }));
}

/** One family of every library, those that have it: each library's `chains/`, say. */
export function libraryFamilyRoots(
  kind: LibraryFamily,
  from?: string,
): AccountLibrary[] {
  return accountLibraries(from)
    .map((l) => ({ name: l.name, root: join(l.root, kind) }))
    .filter((l) => existsSync(l.root));
}

/** The library `path` lies in, and the version folder holding it, or null — a template being edited stands INSIDE one. */
export function libraryOf(path: string): AccountLibrary | null {
  const abs = resolve(path);
  for (const [name, root] of overlays) {
    const inEdits = relative(root, abs);
    if (!inEdits.startsWith("..") && !isAbsolute(inEdits))
      return { name, root };
  }
  const rel = relative(librariesHome(), abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const [name, second] = rel.split(/[\\/]+/);
  if (!isLibraryName(name)) return null;
  const home = libraryHomeOf(name);
  if (isVersionedLibrary(name)) {
    // A path in a version answers to that version; the library's own folder, to itself.
    const v = second === undefined ? null : versionOfDir(second);
    return { name, root: v === null ? home : join(home, String(v)) };
  }
  // An overlaid library is answered by the loop above, wherever its overlay points.
  if (overlays.has(name)) return null;
  return { name, root: home };
}

/** One library's family folder at the version `from`'s workspace pins, or null when it carries none of it. */
export function libraryFamilyRoot(
  library: string,
  kind: LibraryFamily,
  from?: string,
): string | null {
  if (!isLibraryName(library)) return null;
  const root = join(libraryRoot(library, from), kind);
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
  for (const l of libraryFamilyRoots("modules", dir))
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
