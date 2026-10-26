// songs.ts — the songbook: a song is a library song carrying lyrics, a tablature or a sheet, kept in
// its folder by the médiathèque (packages/mediatek/docs/songbook.md). What stays here is each
// person's star. Its sheets, reference track and instrumental are songMedia.ts.

import { mimeFor } from "@studio/mediatek/media";
import type { SongbookSong } from "@studio/mediatek/types";
import type { SongListEntry } from "@studio/rehearsal-shared";
import { compareSongEntries } from "@studio/rehearsal-shared/songList";
import * as db from "../db.ts";
import { serialized } from "../lock.ts";
import * as mediatek from "../mediatek.ts";

/** The song uids `ownerId` starred: a favourite is a person's, not the song's — ../../docs/ownership.md. */
async function favoritesOf(ownerId: string): Promise<Set<string>> {
  if (!ownerId) return new Set();
  const recs = await db.listRecords("SongFavorites", { OwnerId: [ownerId] });
  return new Set(recs.map((r) => String(r.fields.SongUid)));
}

/** A library track as the page plays it: where it is, how it reads, and the name it is saved under. */
const track = (path: string, name: string) => ({
  name,
  mime: mimeFor(path),
  path,
});

/** A song as `viewer` sees it: everyone reads the same song, the star and `mine` are theirs. */
export function publicSong(
  s: SongbookSong,
  viewer = "",
  favorites: Set<string> = new Set(),
) {
  const f = s.facts;
  const name = `${s.artist} - ${s.title}`;
  return {
    id: s.id,
    ownerId: f.owner,
    mine: Boolean(viewer) && f.owner === viewer,
    artist: s.artist,
    title: s.title,
    lyrics: s.lyrics,
    // Timings live in the text now, as `{{MM:SS}}` — ../../../ui-rehearsal/docs/lyricsTiming.md.
    lyricTimings: [],
    tablature: s.tablature,
    sheets: f.sheets.map(({ id, name: sheetName, mime }) => ({
      id,
      name: sheetName,
      mime,
    })),
    // The song's own master, which the page streams from the library — ../../docs/audio.md.
    audio: s.master ? track(s.master, name) : null,
    instrumental: f.instrumental
      ? track(f.instrumental, `${name} (instrumental)`)
      : null,
    // The auto-fetch pipeline's own state — fetchSong/run.ts's runPipeline reads and writes it.
    fetchStatus: {
      phase: f.fetch.phase as SongPhase,
      progress: f.fetch.progress,
      error: f.fetch.error,
      huntId: f.fetch.huntId,
      jobId: f.fetch.jobId,
    },
    lyricsMatch: f.lyricsMatch as SongLyricsMatch,
    fetchIgnored: f.fetchIgnored,
    origin: f.origin,
    favorite: favorites.has(s.id),
    createdAt: f.createdAt,
  };
}

type SongPhase =
  | ""
  | "searching"
  | "downloading"
  | "stemming"
  | "matching-lyrics"
  | "failed";
type SongLyricsMatch = "" | "matched" | "unmatched" | "instrumental";

/** Whether a song is there at all — every song is everyone's to read. */
export async function songVisibleTo(uid: string): Promise<boolean> {
  return (await mediatek.songbook().get(uid)) !== null;
}

/** The server a song was copied from, "" for one of this machine's own — ../../docs/songbookCopy.md. */
export async function songOriginOf(uid: string): Promise<string> {
  return (await mediatek.songbook().get(uid))?.facts.origin ?? "";
}

/** Every songbook song as a row — favourites first; a song's texts come from getSong. */
export async function listSongs(viewer = "") {
  const [entries, favorites] = await Promise.all([
    mediatek.songbook().list(),
    favoritesOf(viewer),
  ]);
  return entries
    .map(
      (e): Omit<SongListEntry, "canDelete"> => ({
        id: e.id,
        mine: Boolean(viewer) && e.owner === viewer,
        artist: e.artist,
        title: e.title,
        hasLyrics: e.hasLyrics,
        hasTablature: e.hasTablature,
        sheetCount: e.sheetCount,
        origin: e.origin,
        favorite: favorites.has(e.id),
        createdAt: e.createdAt,
      }),
    )
    .sort(compareSongEntries);
}

export async function getSong(uid: string, viewer = "") {
  const song = await mediatek.songbook().get(uid);
  if (!song) return null;
  return publicSong(song, viewer, await favoritesOf(viewer));
}

/** Star or unstar a song for `viewer` alone; null when there is no such song. */
async function setSongFavoriteUnlocked(
  uid: string,
  viewer: string,
  favorite: boolean,
) {
  if (!(await songVisibleTo(uid))) return null;
  const mine = await db.listRecords("SongFavorites", {
    OwnerId: [viewer],
    SongUid: [uid],
  });
  if (favorite && mine.length === 0)
    await db.addRecords("SongFavorites", [{ SongUid: uid, OwnerId: viewer }]);
  if (!favorite && mine.length > 0)
    await db.deleteRecords(
      "SongFavorites",
      mine.map((r) => r.id),
    );
  return getSong(uid, viewer);
}

export async function createSong(
  ownerId: string,
  { artist, title }: { artist: string; title: string },
) {
  const song = await mediatek
    .songbook()
    .create({ artist, title, owner: ownerId });
  return song && publicSong(song, ownerId);
}

/** What an edit of a song may change; the fetch status field by field. */
interface SongPatch {
  artist?: string;
  title?: string;
  lyrics?: string;
  tablature?: string;
  fetchStatus?: Partial<{
    phase: string;
    progress: number | null;
    error: string;
    huntId: string;
    jobId: string;
  }>;
  lyricsMatch?: string;
  fetchIgnored?: boolean;
}

export async function updateSong(uid: string, patch: SongPatch) {
  const { fetchStatus, ...rest } = patch;
  const song = await mediatek.songbook().patch(uid, {
    ...rest,
    ...(fetchStatus ? { fetch: fetchStatus } : {}),
  });
  return song && publicSong(song);
}

/** Remove a song from the songbook — its texts and sheets go; its audio stays a library song — and every star on it. */
export async function deleteSong(uid: string): Promise<boolean> {
  if (!(await songVisibleTo(uid))) return false;
  await mediatek.songbook().remove(uid);
  const stars = await db.listRecords("SongFavorites", { SongUid: [uid] });
  if (stars.length)
    await db.deleteRecords(
      "SongFavorites",
      stars.map((r) => r.id),
    );
  return true;
}

// One star at a time per person and song — a read-modify-write has no transaction to lean on (../lock.ts).
export function setSongFavorite(
  ...args: Parameters<typeof setSongFavoriteUnlocked>
) {
  return serialized(`favorite:${args[1]}:${args[0]}`, () =>
    setSongFavoriteUnlocked(...args),
  );
}
