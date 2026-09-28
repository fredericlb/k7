// libraryFiles.ts — the SOUND files an account library shares: its `samples/` and `irs/`. A file
// there is named `@<library>/<path under that folder>`, the way a module is named `@<library>/…`,
// so a song says which library it took an IR from and moves between machines with the name intact.
// Listing and resolving only; the folders are found where the libraries are (docs/libraryFiles.md).

import { type Dirent, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isLibraryAudio } from "@studio/song-schema/moduleTypes";
import { libraryFamilyRoot, libraryFamilyRoots } from "./sharedFolders";

/** The two families that hold sound files rather than modules. */
export type SoundFamily = "samples" | "irs";

/** A library's folders nest by instrument or by maker; deeper than this is a link loop, not a shelf. */
const MAX_DEPTH = 6;

/** Every sound file in every library's `family` folder, as `@<library>/<path>`, sorted. */
export function libraryFiles(family: SoundFamily): string[] {
  const out: string[] = [];
  for (const lib of libraryFamilyRoots(family)) {
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
        } else if (isLibraryAudio(e.name))
          out.push(
            `@${lib.name}/${relative(lib.root, p).split(sep).join("/")}`,
          );
      }
    };
    walk(lib.root, 0);
  }
  return out.sort();
}

/** The file a `@<library>/<path>` ref names in that library's `family` folder, or undefined — never outside it. */
export function libraryFile(
  family: SoundFamily,
  ref: unknown,
): string | undefined {
  if (typeof ref !== "string") return undefined;
  const m = /^@([^/]+)\/(.+)$/.exec(ref);
  if (!m) return undefined;
  const root = libraryFamilyRoot(m[1], family);
  if (!root) return undefined;
  const abs = resolve(root, m[2]);
  // A `..` in the path would reach out of the folder, and a ref is text a file may hold.
  return abs.startsWith(root + sep) ? abs : undefined;
}
