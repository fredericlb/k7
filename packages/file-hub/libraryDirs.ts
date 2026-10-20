// libraryDirs.ts — what the hub reads off a library's folder: its version numbers, each version's manifest,
// whether a seed is already one of them, and the HUSKS — version folders holding no file but dot-files.
// A husk is what a read-only follow leaves of a version only this machine had: its files undone, its
// folders and dot-files (which no capture sees) kept. It is no version, and nothing is lost removing it.
// See docs/fileHub.md.

import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { upgradeLegacy } from "@studio/file-service/src/legacyUpgrade.ts";
import { RECYCLE_DIR } from "@studio/file-service/src/workspaceFilter.ts";
import {
  LIBRARY_MANIFEST,
  type LibraryManifest,
  parseLibraryManifest,
  stringifyLibraryManifest,
  UNPINNED_VERSION,
  versionOfDir,
} from "@studio/song-schema/libraryVersions";
import {
  LEGACY_LIBRARY_MANIFEST,
  parseLegacyLibraryManifest,
} from "@studio/song-schema/libraryVersionsLegacy";

/** What a published version carries: never a `.git`, never a recycle bin. */
export const publishable = (src: string): boolean =>
  !src.split(/[\\/]/).some((s) => s === ".git" || s === RECYCLE_DIR);

/** The published version numbers under a library's folder, ascending. */
export function versionNumbers(at: string): number[] {
  try {
    return readdirSync(at, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => versionOfDir(d.name))
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Does `dir` hold no file but dot-named ones, at any depth? A manifest is a file, so a real version never is. */
export function isHusk(dir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (!e.isDirectory() || !isHusk(join(dir, e.name))) return false;
  }
  return true;
}

/** A version's manifest, `library.k7x` or else a legacy `library.yaml`, read where it is: a seed is not the hub's to write. */
export function readManifest(dir: string): LibraryManifest | null {
  try {
    return parseLibraryManifest(
      readFileSync(join(dir, LIBRARY_MANIFEST), "utf8"),
    );
  } catch {
    try {
      return parseLegacyLibraryManifest(
        readFileSync(join(dir, LEGACY_LIBRARY_MANIFEST), "utf8"),
      );
    } catch {
      return null;
    }
  }
}

/** The manifest in either format, for upgradeLegacy. */
const MANIFEST = {
  parseLegacy: parseLegacyLibraryManifest,
  parse: parseLibraryManifest,
  stringify: stringifyLibraryManifest,
};

/** A legacy `library.yaml` in a folder the hub owns, upgraded once to `library.k7x`. */
export function upgradeManifest(dir: string): void {
  upgradeLegacy(
    join(dir, LEGACY_LIBRARY_MANIFEST),
    join(dir, LIBRARY_MANIFEST),
    MANIFEST,
  );
}

/** Is the version whose manifest is `held` this seed, installed under its own number or, renumbered, under another? */
export function isCopyOfSeed(
  held: LibraryManifest | null,
  seed: LibraryManifest,
): boolean {
  if (!held) return false;
  if (held.seed !== undefined) return held.seed === seed.version;
  return (
    held.version === seed.version &&
    held.requires === seed.requires &&
    held.notes === seed.notes
  );
}

/** A manifest of the hub's own folders: upgraded first, then read. */
export function ownManifest(dir: string): LibraryManifest | null {
  upgradeManifest(dir);
  return readManifest(dir);
}

/** Version 1 of a library written before versions: it asks for nothing past the first level. */
export function writeFirstManifest(name: string, dir: string): void {
  upgradeManifest(dir);
  if (existsSync(join(dir, LIBRARY_MANIFEST))) return;
  writeFileSync(
    join(dir, LIBRARY_MANIFEST),
    stringifyLibraryManifest({ name, version: UNPINNED_VERSION, requires: 1 }),
  );
}
