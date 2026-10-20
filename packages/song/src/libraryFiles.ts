import { join, resolve } from "node:path";
import {
  isLibraryFileOf,
  type LibraryFileFamily,
  sharedFamilyOf,
} from "@studio/song-schema/moduleTypes";
import { isBelow } from "@studio/web-protocol/paths";
import { resolveModuleAssetIn } from "./assetPath";
import { listFilesUnder } from "./listFiles";
import { libraryFamilyRoot, libraryFamilyRoots } from "./sharedFolders";

/** The families that hold files rather than modules: sounds, and the amp models. */
export type SoundFamily = LibraryFileFamily;

/** A library's folders nest by instrument or by maker; deeper than this is a link loop, not a shelf. */
const MAX_DEPTH = 6;

/** The level a project's own sounds answer to, as a library's answer to its name. */
export const PROJECT_SOUNDS = "project";

/** Every file in every library's `family` folder — and the project's, given one — as `@<level>/<path>`, sorted, the project's first. */
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
  for (const lib of roots)
    for (const path of listFilesUnder(lib.root, { maxDepth: MAX_DEPTH }))
      if (isLibraryFileOf(family, path.slice(path.lastIndexOf("/") + 1)))
        out.push(`@${lib.name}/${path}`);
  // The project's own first, whatever the libraries are called; each level sorted inside.
  const own = (ref: string): number =>
    ref.startsWith(`@${PROJECT_SOUNDS}/`) ? 0 : 1;
  return out.sort((a, b) => own(a) - own(b) || (a < b ? -1 : a > b ? 1 : 0));
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
  return isBelow(root, abs) ? abs : undefined;
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
