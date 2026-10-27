// songMatch.ts — is this library entry, or this identified recording, the song a person named?
// Artist and title equal once normalised, else every typed word found, else a typo away. Pure, and
// HERE because the songbook and the médiathèque's "Add a song" both check a hunt with it — docs/songs.md.

import { similarity } from "@studio/lyrics/lrc";
import { songMatches } from "./playlistItems.ts";
import type { MediatekEntry } from "./types.ts";

const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// How alike two artists must be, the title being the same: a letter off (Gonzales / González), not another band.
const ARTIST_TYPO = 0.85;

/** The library song that is this artist's title — exact, then every word found, then the same title by
 * an artist a typo away; only songs with a master count. */
export function findLibrarySong(
  entries: readonly MediatekEntry[],
  artist: string,
  title: string,
): MediatekEntry | undefined {
  const songs = entries.filter((e) => e.meta?.master);
  const a = normalize(artist);
  const t = normalize(title);
  const artistOf = (e: MediatekEntry) =>
    normalize(String(e.meta?.artist ?? ""));
  return (
    songs.find((e) => artistOf(e) === a && normalize(e.name) === t) ??
    songs.find((e) => songMatches(e, `${artist} ${title}`)) ??
    songs.find(
      (e) =>
        normalize(e.name) === t && similarity(artistOf(e), a) >= ARTIST_TYPO,
    )
  );
}

/** Is what MusicBrainz or Deezer identified this song? Artist and title each a typo away at most. */
export function sameSong(
  artist: string,
  title: string,
  foundArtist: string,
  foundTitle: string,
): boolean {
  return (
    similarity(normalize(foundArtist), normalize(artist)) >= ARTIST_TYPO &&
    similarity(normalize(foundTitle), normalize(title)) >= ARTIST_TYPO
  );
}

/** Is `candidateArtist`/`candidateTitle` this song, once normalised? The same exact bar
 * `findLibrarySong` tries first — no loose fallback, since a wrong auto-applied lyric is
 * worse than asking (the songbook's fetchSong/run.ts). */
export function matches(
  artist: string,
  title: string,
  candidateArtist: string,
  candidateTitle: string,
): boolean {
  return (
    normalize(candidateArtist) === normalize(artist) &&
    normalize(candidateTitle) === normalize(title)
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
