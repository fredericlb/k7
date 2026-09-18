// match.ts — which song of pl8's library a songbook song is: artist and title equal once normalised,
// else every typed word found (pl8's own `songMatches`). Pure, so tested without pl8.

import { songMatches } from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";

const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The library song that is this artist's title — exact first, loose second; only songs with a master count. */
export function findLibrarySong(
  entries: readonly MediatekEntry[],
  artist: string,
  title: string,
): MediatekEntry | undefined {
  const songs = entries.filter((e) => e.meta?.master);
  const a = normalize(artist);
  const t = normalize(title);
  return (
    songs.find(
      (e) =>
        normalize(String(e.meta?.artist ?? "")) === a &&
        normalize(e.name) === t,
    ) ?? songs.find((e) => songMatches(e, `${artist} ${title}`))
  );
}

/** The library song a path lands in — a hunt answers with the folder or with the master inside it. */
export function songAtPath(
  entries: readonly MediatekEntry[],
  landed: string | undefined,
): MediatekEntry | undefined {
  if (!landed) return undefined;
  return entries.find(
    (e) =>
      e.meta?.master && (e.path === landed || landed.startsWith(`${e.path}/`)),
  );
}

/** The master file of a library song, the path pl8's file and stems routes take. */
export const masterPath = (entry: MediatekEntry): string =>
  `${entry.path}/${String(entry.meta?.master ?? "")}`;
