// libraryPins.ts — a workspace's `_library-pins.k7x`, written ONCE, the first time it is opened or
// when it is made, naming the version of each library it already hears: version 1 for a workspace
// from before versions, the newest this k7 runs for a new one, the draft for an admin's. After
// that only an upgrade rewrites it. See ../../../docs/library-versions-plan.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@studio/song/atomicWrite";
import {
  accountLibraries,
  libraryManifest,
  newestRunnableVersion,
  workspacePins,
} from "@studio/song/sharedFolders";
import {
  DRAFT_VERSION,
  LIBRARY_PINS_FILE,
  type LibraryPins,
  type LibraryVersion,
  parseLibraryPins,
  pinnedVersion,
  stringifyLibraryPins,
  UNPINNED_VERSION,
} from "@studio/song-schema/libraryVersions";
import {
  LEGACY_LIBRARY_PINS_FILE,
  parseLegacyLibraryPins,
} from "@studio/song-schema/libraryVersionsLegacy";
import { upgradeLegacy } from "./legacyUpgrade.ts";
import { askHubRemote } from "./libraries.ts";

/** The pins file in either format, for upgradeLegacy. */
const PINS = {
  parseLegacy: parseLegacyLibraryPins,
  parse: parseLibraryPins,
  stringify: stringifyLibraryPins,
};

/** Each library's version as the workspace at `dir` plays it, and the newest this k7 could move to — here or at the origin. */
export async function libraryVersionsAt(
  dir: string,
): Promise<Map<string, LibraryVersionRow>> {
  const pins = workspacePins(dir);
  const out = new Map<string, LibraryVersionRow>();
  for (const { name } of accountLibraries()) {
    const pinned = pinnedVersion(pins, name);
    const newest = newestRunnableVersion(name, await askHubRemote(name));
    const row: LibraryVersionRow = { pinned };
    // What the pinned version needs of the ENGINE's machine, which the editor reads against it.
    if (typeof pinned === "number") {
      const requires = libraryManifest(name, pinned)?.requires;
      if (requires) row.requires = requires;
      if (newest > pinned) row.upgrade = newest;
    }
    out.set(name, row);
  }
  return out;
}

/** One library's row: the version played, what it needs, and the newest this k7 could move to. */
type LibraryVersionRow = {
  pinned: LibraryVersion;
  requires?: number;
  upgrade?: number;
};

/** Give the workspace at `root` its pins when it has none; answers the pins written, or null when it had some. */
export function ensureLibraryPins(
  root: string,
  opts: { fresh: boolean; admin: boolean },
): LibraryPins | null {
  const file = join(root, LIBRARY_PINS_FILE);
  if (existsSync(file)) return null;
  // A workspace pinned before k7x keeps its pins, upgraded once to `_library-pins.k7x`.
  const legacy = join(root, LEGACY_LIBRARY_PINS_FILE);
  if (existsSync(legacy)) {
    upgradeLegacy(legacy, file, PINS);
    return null;
  }
  const pins: LibraryPins = {};
  for (const { name } of accountLibraries())
    pins[name] = opts.admin
      ? DRAFT_VERSION
      : opts.fresh
        ? newestRunnableVersion(name)
        : UNPINNED_VERSION;
  // Through a dot-named temp, which live sync skips, and a rename: no replica sees half a pins file.
  writeFileAtomic(file, stringifyLibraryPins(pins));
  return pins;
}
