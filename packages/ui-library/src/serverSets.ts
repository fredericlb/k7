// serverSets.ts — which server-only entries a bulk download takes: a folder's (an album, an artist), a
// playlist's. Pure, so it is tested without a screen.
// The one thing a reader would get wrong: only what is ABSENT here is named, never a folder whole — a
// song edited on this machine must not be overwritten by the server's copy (../../mediatek/docs/serverCopy.md).

import { findSong, type ResolvedItem } from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";

/** The server-only paths at or under `folder` (family-prefixed), in path order. */
export function missingUnder(
  serverOnly: MediatekEntry[],
  folder: string,
): string[] {
  return serverOnly
    .map((e) => e.path)
    .filter((p) => p === folder || p.startsWith(`${folder}/`))
    .sort();
}

/** The server-only songs a playlist names and this machine lacks, deduplicated, in playlist order. */
export function playlistMissing(
  rows: ResolvedItem[],
  serverOnly: MediatekEntry[],
): string[] {
  const paths = rows
    .filter((r) => !r.song)
    .map((r) => findSong(r.item.song, serverOnly)?.path)
    .filter((p): p is string => !!p);
  return [...new Set(paths)];
}
