// confine.ts — the ONE check a path read from a song file passes before anything opens, copies or
// deletes it: inside an allowed root, lexically AND through the symlinks on disk.
// The one thing a reader would get wrong: every account's file service runs as the same OS user
// over one data root, so a `../` in a song file is another account's file, not a typo — docs/confine.md.

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AUTO_RENDERS_HOME_DIR,
  isLibraryName,
} from "@studio/song-schema/moduleTypes";
import { modelsRoot } from "./modelCache";
import {
  accountLibraryHome,
  librariesHome,
  libraryHomeOf,
  libraryOverlays,
  META_MODULES_ROOT,
} from "./sharedFolders";
import { studioHome } from "./studioHome";

/** Is `p` the root itself or under it — both already resolved. */
const within = (p: string, root: string): boolean =>
  p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** Is there anything at `p`, a dangling link included — which realpath then refuses. */
function present(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The real path of an existing path; `fallback` when it cannot be read. */
function realOr<T>(path: string, fallback: T): string | T {
  try {
    return realpathSync(path);
  } catch {
    return fallback;
  }
}

/** `path` resolved and absolute when it lies inside one of `roots`, symlinks followed; null otherwise. */
export function confineTo(
  roots: readonly string[],
  path: string,
): string | null {
  if (typeof path !== "string" || !path || path.includes("\0")) return null;
  const p = resolve(path);
  for (const raw of roots) {
    if (!raw) continue;
    const root = resolve(raw);
    if (!within(p, root)) continue;
    let probe = p;
    while (probe !== root && !present(probe)) probe = dirname(probe);
    // Below a root that does not exist nothing exists either, so no link can lead out of it.
    if (!present(probe)) return p;
    const real = realOr(probe, null);
    if (real && within(real, realOr(root, root))) return p;
    // A link inside this root may still land inside another allowed one.
    if (
      real &&
      roots.some((r) => r && within(real, realOr(resolve(r), resolve(r))))
    )
      return p;
  }
  return null;
}

/** Every library folder this account reads — the account's own, each of the origin's, each overlay. */
export function libraryReadRoots(): string[] {
  const out = [accountLibraryHome()];
  try {
    for (const e of readdirSync(librariesHome(), { withFileTypes: true }))
      if (e.isDirectory() && isLibraryName(e.name))
        out.push(libraryHomeOf(e.name));
  } catch {
    // no libraries yet — the ordinary state of a new machine
  }
  for (const o of libraryOverlays()) out.push(o.root);
  return out;
}

/** The workspace a project stands in: `<home>/workspace/<name>` when it is there, else its parent folder. */
export function workspaceDirOf(projectDir: string): string {
  const dir = resolve(projectDir);
  // The folder engine-client's rootDir() names, which song may not import.
  const home = join(studioHome(), "workspace");
  const rel = relative(home, dir);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel))
    return join(home, rel.split(/[\\/]+/)[0]);
  return dirname(dir);
}

/** What a path a project's files name may reach — the list and its reasons are docs/confine.md. */
export function projectRoots(projectDir: string): string[] {
  return [
    resolve(projectDir),
    workspaceDirOf(projectDir),
    ...libraryReadRoots(),
    META_MODULES_ROOT,
    join(studioHome(), AUTO_RENDERS_HOME_DIR),
    modelsRoot(),
  ];
}

/** `ref`, relative to `base` (the project by default), confined to the project's roots; null when it escapes. */
export function confineToProject(
  projectDir: string,
  ref: unknown,
  base: string = projectDir,
): string | null {
  if (typeof ref !== "string" || !ref) return null;
  return confineTo(projectRoots(projectDir), resolve(base, ref));
}
