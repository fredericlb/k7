// libraries.ts — the LIBRARIES as this account's service sees them: the hub's one folder of each
// (`$STUDIO_LIBRARIES_HOME`), which the hub gives every listed library. An admin writes that folder
// IN PLACE, and the hub relays what changed (st0fs); anyone else reads it only.
// Rationale: packages/song/docs/sharedFolders.md, mechanics: docs/libraries.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isLibraryName,
  isVersionedLibrary,
  librariesHome,
  libraryHomeOf,
  setLibraryOverlays,
} from "@studio/song/sharedFolders";
import { DRAFT_VERSION } from "@studio/song-schema/libraryVersions";
import { HUB_SECRET_HEADER, type LibraryNote } from "@studio/web-protocol";

/** The versions the origin publishes of `name`, as the hub hears them; none without a hub or an origin to ask. */
export async function askHubRemote(
  name: string,
): Promise<{ version: number; requires: number }[]> {
  const url = process.env.STUDIO_HUB_URL;
  if (!url) return [];
  try {
    const r = await fetch(`${url}/libraries/remote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HUB_SECRET_HEADER]: process.env.STUDIO_HUB_SECRET ?? "",
      },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return [];
    return (
      (await r.json()) as { versions: { version: number; requires: number }[] }
    ).versions;
  } catch {
    return []; // the hub's own listing is a convenience: what is here still upgrades
  }
}

/** Ask the hub to give the listed libraries (or `name`) their folders; without a hub, the folders are what is there. */
export async function askHubSync(
  opts: { name?: string; draft?: boolean; version?: number } = {},
): Promise<LibraryNote[]> {
  const url = process.env.STUDIO_HUB_URL;
  const secret = process.env.STUDIO_HUB_SECRET ?? "";
  if (!url) return [];
  const r = await fetch(`${url}/libraries/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HUB_SECRET_HEADER]: secret,
    },
    body: JSON.stringify(opts),
  });
  if (!r.ok)
    throw new Error(`the hub could not prepare the libraries (${r.status})`);
  return ((await r.json()) as { notes?: LibraryNote[] }).notes ?? [];
}

/** The libraries on disk, by name. */
function onDisk(): string[] {
  try {
    return readdirSync(librariesHome(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && isLibraryName(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** What an OPEN does: the folders made sure of, and for an admin every library's DRAFT writable, read-only otherwise. */
export async function refreshLibraries(admin = false): Promise<void> {
  await askHubSync({ draft: admin }).catch((e: Error) =>
    console.warn(`[libraries] ${e.message}`),
  );
  setLibraryOverlays(
    admin ? onDisk().map((name) => ({ name, root: draftRoot(name) })) : [],
  );
}

/** Where an admin edits library `name`: its draft, or the whole folder of one not yet laid out as versions. */
function draftRoot(name: string): string {
  return isVersionedLibrary(name)
    ? join(libraryHomeOf(name), DRAFT_VERSION)
    : libraryHomeOf(name);
}
