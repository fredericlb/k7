// libraryFiles.ts — the files a song can name in a library: `samples/`, `irs/` and `models/`, as
// `@<library>/<path>`, and the PROJECT's own, as `@project/<path>` — a song carrying a sound only it
// plays, as a demo does. The name travels between machines where an absolute path would not.
// Listing and resolving only; the folders are found where they sit (docs/libraryFiles.md).

import { type Dirent, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  isLibraryFileOf,
  type LibraryFileFamily,
  sharedFamilyOf,
} from "@studio/song-schema/moduleTypes";
import { resolveModuleAssetIn } from "./assetPath";
import { libraryFamilyRoot, libraryFamilyRoots } from "./sharedFolders";

/** The families that hold files rather than modules: sounds, and the amp models. */
export type SoundFamily = LibraryFileFamily;

/** A library's folders nest by instrument or by maker; deeper than this is a link loop, not a shelf. */
const MAX_DEPTH = 6;

/** The level a project's own sounds answer to, as a library's answer to its name. */
export const PROJECT_SOUNDS = "project";

/** Every file in every library's `family` folder — and the project's, given one — as `@<level>/<path>`, sorted. */
export function libraryFiles(
  family: SoundFamily,
  projectDir?: string,
): string[] {
  const out: string[] = [];
  const roots = [
    ...(projectDir
      ? [{ name: PROJECT_SOUNDS, root: join(projectDir, family) }]
      : []),
    ...libraryFamilyRoots(family, projectDir),
  ];
  for (const lib of roots) {
    const walk = (abs: string, depth: number): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return; // unreadable — listed as empty, the way a missing folder is
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = join(abs, e.name);
        if (e.isDirectory()) {
          if (depth < MAX_DEPTH) walk(p, depth + 1);
        } else if (isLibraryFileOf(family, e.name))
          out.push(
            `@${lib.name}/${relative(lib.root, p).split(sep).join("/")}`,
          );
      }
    };
    walk(lib.root, 0);
  }
  return out.sort();
}

/** The file a `@<library>/<path>` or `@project/<path>` ref names in that `family` folder, or undefined — never outside it. */
export function libraryFile(
  family: SoundFamily,
  ref: unknown,
  projectDir?: string,
): string | undefined {
  if (typeof ref !== "string") return undefined;
  const m = /^@([^/]+)\/(.+)$/.exec(ref);
  if (!m) return undefined;
  const root =
    m[1] === PROJECT_SOUNDS
      ? projectDir
        ? join(projectDir, family)
        : null
      : libraryFamilyRoot(m[1], family, projectDir);
  if (!root) return undefined;
  const abs = resolve(root, m[2]);
  // A `..` in the path would reach out of the folder, and a ref is text a file may hold.
  return abs.startsWith(root + sep) ? abs : undefined;
}

/** A file param's file: a library's when the param may name one and the ref says `@<library>/`, else the module's own `assets/`. */
export function resolveFileParamIn(
  param: string,
  ref: unknown,
  folders: readonly (string | undefined)[],
): string | undefined {
  const family = sharedFamilyOf(param);
  if (family && typeof ref === "string" && ref.startsWith("@"))
    return libraryFile(family, ref, folders.find(Boolean));
  return resolveModuleAssetIn(ref, folders);
}
