// libraries.ts — the LIBRARIES as this account's service sees them: the hub's one folder of each
// (`$STUDIO_LIBRARIES_HOME`), which the hub gives every listed library. An admin writes that folder
// IN PLACE, and the hub relays what changed (st0fs); anyone else reads it only.
// Rationale: packages/song/docs/sharedFolders.md, mechanics: docs/libraries.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isLibraryName,
  librariesHome,
  setLibraryOverlays,
} from "@studio/song/sharedFolders";
import { HUB_SECRET_HEADER, type LibraryNote } from "@studio/web-protocol";

/** Ask the hub to give the listed libraries (or `name`) their folders; without a hub, the folders are what is there. */
export async function askHubSync(
  opts: { name?: string } = {},
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

/** What an OPEN does: the folders made sure of, and every library writable in place for an admin, read-only otherwise. */
export async function refreshLibraries(admin = false): Promise<void> {
  await askHubSync().catch((e: Error) =>
    console.warn(`[libraries] ${e.message}`),
  );
  setLibraryOverlays(
    admin
      ? onDisk().map((name) => ({ name, root: join(librariesHome(), name) }))
      : [],
  );
}
