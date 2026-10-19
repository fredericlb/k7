// library.ts — the `library …` verbs: which version of each library the WORKSPACE plays, and moving
// that pin. They act on `repoDir`, since `_library-pins.k7x` is the workspace's, and need no project.
// A version this k7 cannot run is refused by name; one this machine lacks is asked of the host.
// See ../../../../docs/library-versions-plan.md.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forksWhoseBaseMoved } from "@studio/song/libraryForks";
import {
  accountLibraries,
  libraryManifest,
  libraryVersions,
  newestRunnableVersion,
  workspacePins,
} from "@studio/song/sharedFolders";
import { wsEdit } from "@studio/song/yaml/workspaceDoc";
import {
  DRAFT_VERSION,
  LIBRARY_LEVEL,
  LIBRARY_PINS_FILE,
  type LibraryPins,
  type LibraryVersion,
  parseLibraryPins,
  pinnedVersion,
} from "@studio/song-schema/libraryVersions";
import { LEGACY_LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersionsLegacy";
import type { SidHandler } from "../commands.ts";

/** The workspace's pins file and what it says, or null when the host names no workspace. */
function readPins(
  h: Parameters<SidHandler>[1],
): { abs: string; pins: LibraryPins } | null {
  if (!h.repoDir) return null;
  const abs = join(h.repoDir, LIBRARY_PINS_FILE);
  return {
    abs,
    pins: existsSync(abs)
      ? parseLibraryPins(readFileSync(abs, "utf8"))
      : // A legacy YAML pins file is upgraded by song on this read, so the edit below lands in the .k7x one.
        existsSync(join(h.repoDir, LEGACY_LIBRARY_PINS_FILE))
        ? workspacePins(h.repoDir)
        : {},
  };
}

/** The lowest level version `v` of `name` needs; a version with no manifest needs nothing. */
const requiresOf = (name: string, v: number): number =>
  libraryManifest(name, v)?.requires ?? 1;

export const LIBRARY_VERBS: Record<string, SidHandler> = {
  /** `library versions` — each library: the version pinned here, and those this machine holds. */
  "library.versions": async (_a, h) => {
    const read = readPins(h);
    if (!read) return h.refuse(["library versions: no workspace is open"]);
    const remote: Record<string, { version: number; requires: number }[]> = {};
    for (const { name } of accountLibraries())
      remote[name] = (await h.remoteLibraryVersions?.(name)) ?? [];
    const lines = accountLibraries().map(({ name }) => {
      const pinned = pinnedVersion(read.pins, name);
      const held = libraryVersions(name).map((v) =>
        requiresOf(name, v) > LIBRARY_LEVEL
          ? `${v} (needs level ${requiresOf(name, v)})`
          : String(v),
      );
      const newest = newestRunnableVersion(name, remote[name]);
      const behind =
        typeof pinned === "number" && newest > pinned
          ? ` — ${newest} is ready: library upgrade ${name}`
          : "";
      return `@${name}: plays ${pinned}; here ${held.join(", ") || "none"}${behind}`;
    });
    h.log(lines.length ? lines : ["no library on this machine"]);
  },

  /** `library upgrade <library> [version]` — move the pin; unsaid, to the newest version this k7 runs. */
  "library.upgrade": async (a, h) => {
    const read = readPins(h);
    if (!read) return h.refuse(["library upgrade: no workspace is open"]);
    const [name, wanted] = a.trim().split(/\s+/);
    if (!name || !accountLibraries().some((l) => l.name === name))
      return h.refuse([
        `library upgrade: name one of ${accountLibraries()
          .map((l) => l.name)
          .join(", ")}`,
      ]);
    const from = pinnedVersion(read.pins, name);
    let to: LibraryVersion;
    if (wanted === DRAFT_VERSION) to = DRAFT_VERSION;
    else if (wanted) {
      to = Number(wanted);
      if (!Number.isInteger(to) || to < 1)
        return h.refuse([`library upgrade: '${wanted}' is no version`]);
    } else
      to = newestRunnableVersion(
        name,
        (await h.remoteLibraryVersions?.(name)) ?? [],
      );
    if (to === from) return h.log([`@${name} already plays ${from}`]);
    // A version this machine lacks is the host's to bring down; the verb has no network.
    if (typeof to === "number" && !libraryVersions(name).includes(to)) {
      // Refused before any download when the origin already says it needs a newer k7.
      const announced = (await h.remoteLibraryVersions?.(name))?.find(
        (r) => r.version === to,
      );
      if (announced && announced.requires > LIBRARY_LEVEL)
        return h.refuse([
          `@${name} ${to} needs k7 level ${announced.requires}; this k7 runs level ${LIBRARY_LEVEL} — update k7 first`,
        ]);
      if (!h.fetchLibraryVersion)
        return h.refuse([`@${name} ${to} is not on this machine`]);
      const why = await h.fetchLibraryVersion(name, to);
      if (why) return h.refuse([`@${name} ${to}: ${why}`]);
    }
    if (typeof to === "number" && requiresOf(name, to) > LIBRARY_LEVEL)
      return h.refuse([
        `@${name} ${to} needs k7 level ${requiresOf(name, to)}; this k7 runs level ${LIBRARY_LEVEL} — update k7 first`,
      ]);
    try {
      h.snapshot?.(read.abs);
      wsEdit(read.abs, (doc) => doc.setIn([name], to), { create: true });
    } catch (e) {
      return h.refuse([`library upgrade: ${(e as Error).message}`]);
    }
    // The pins sit outside every project folder, so no change token sees them: the song is recompiled here.
    await h.reload();
    const moved = h.repoDir
      ? forksWhoseBaseMoved(h.repoDir, name, from, to)
      : [];
    h.log([
      `@${name}: ${from} → ${to}`,
      ...moved.map((f) => `  ${f.module} extends ${f.base}, which changed`),
    ]);
  },
};
