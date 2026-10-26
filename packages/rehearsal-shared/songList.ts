// songList.ts — a songbook row out of a whole song, and the order the songbook lists rows in.
// The server builds its rows without reading the texts; the browser patches one from a song it was answered.

import type { Song, SongListEntry } from "./types.ts";

type Ordered = Pick<SongListEntry, "favorite" | "artist" | "title">;

/** Favourites first, then by artist, then by title. */
export function compareSongEntries(a: Ordered, b: Ordered): number {
  return (
    Number(b.favorite) - Number(a.favorite) ||
    a.artist.localeCompare(b.artist) ||
    a.title.localeCompare(b.title)
  );
}

/** The row a whole song makes, the same the server lists. */
export function songListEntryOf(song: Song): SongListEntry {
  return {
    id: song.id,
    artist: song.artist,
    title: song.title,
    hasLyrics: song.lyrics.trim() !== "",
    hasTablature: song.tablature.trim() !== "",
    sheetCount: song.sheets.length,
    favorite: song.favorite,
    mine: song.mine,
    canDelete: song.canDelete,
    origin: song.origin,
    createdAt: song.createdAt,
  };
}

/** `entries` with `song`'s row put in or replaced, in songbook order. */
export function withSongEntry(
  entries: SongListEntry[],
  song: Song,
): SongListEntry[] {
  const row = songListEntryOf(song);
  return [...entries.filter((e) => e.id !== row.id), row].sort(
    compareSongEntries,
  );
}
