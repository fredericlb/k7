// libraryPins.ts — a workspace's `_library-pins.yaml`, written ONCE, the first time it is opened or
// when it is made, naming the version of each library it already hears: version 1 for a workspace
// from before versions, the newest this st0 runs for a new one, the draft for an admin's. After
// that only an upgrade rewrites it. See ../../../docs/library-versions-plan.md.

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountLibraries,
  newestRunnableVersion,
  workspacePins,
} from "@studio/song/sharedFolders";
import {
  DRAFT_VERSION,
  LIBRARY_PINS_FILE,
  type LibraryPins,
  type LibraryVersion,
  pinnedVersion,
  stringifyLibraryPins,
  UNPINNED_VERSION,
} from "@studio/song-schema/libraryVersions";
import { askHubRemote } from "./libraries.ts";

/** Each library's version as the workspace at `dir` plays it, and the newest this st0 could move to — here or at the origin. */
export async function libraryVersionsAt(
  dir: string,
): Promise<Map<string, { pinned: LibraryVersion; upgrade?: number }>> {
  const pins = workspacePins(dir);
  const out = new Map<string, { pinned: LibraryVersion; upgrade?: number }>();
  for (const { name } of accountLibraries()) {
    const pinned = pinnedVersion(pins, name);
    const newest = newestRunnableVersion(name, await askHubRemote(name));
    out.set(
      name,
      typeof pinned === "number" && newest > pinned
        ? { pinned, upgrade: newest }
        : { pinned },
    );
  }
  return out;
}

/** Give the workspace at `root` its pins when it has none; answers the pins written, or null when it had some. */
export function ensureLibraryPins(
  root: string,
  opts: { fresh: boolean; admin: boolean },
): LibraryPins | null {
  const file = join(root, LIBRARY_PINS_FILE);
  if (existsSync(file)) return null;
  const pins: LibraryPins = {};
  for (const { name } of accountLibraries())
    pins[name] = opts.admin
      ? DRAFT_VERSION
      : opts.fresh
        ? newestRunnableVersion(name)
        : UNPINNED_VERSION;
  // Through a dot-named sibling, which live sync skips, and a rename: no replica sees half a pins file.
  const tmp = join(root, `.${LIBRARY_PINS_FILE}.${process.pid}`);
  writeFileSync(tmp, stringifyLibraryPins(pins));
  renameSync(tmp, file);
  return pins;
}
