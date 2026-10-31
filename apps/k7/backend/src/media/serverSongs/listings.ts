// listings.ts — the last listing each server gave of each family, kept on disk under the library's root, so a
// phone restarted offline still shows the server's songs and their icons. Written only when the revision moved.
// See packages/mediatek/docs/serverCopy.md.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";
import type { FamilyListing } from "@studio/mediatek/types";

/** Dot-named, so neither the scan nor the change token sees it. */
const FILE = ".server-listings.json";

let held: { file: string; listings: Map<string, FamilyListing> } | null = null;

/** The map for the CURRENT root, read from disk the first time it is asked for. */
function listings(): Map<string, FamilyListing> {
  const file = join(mediatekDir(), FILE);
  if (held?.file === file) return held.listings;
  let read: Record<string, FamilyListing> = {};
  try {
    read = JSON.parse(readFileSync(file, "utf8")) as typeof read;
  } catch {
    // None yet, or unreadable: the next answer writes it again.
  }
  held = { file, listings: new Map(Object.entries(read)) };
  return held.listings;
}

export const lastListing = (key: string): FamilyListing | undefined =>
  listings().get(key);

/** Remember `listing` under `key`; the disk is written only when its revision is new. */
export function keepListing(key: string, listing: FamilyListing): void {
  const all = listings();
  const was = all.get(key);
  all.set(key, listing);
  if (was?.rev === listing.rev) return;
  const file = join(mediatekDir(), FILE);
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(all)));
    renameSync(`${file}.tmp`, file);
  } catch {
    // Best effort: the listing in memory still answers until the next restart.
  }
}
