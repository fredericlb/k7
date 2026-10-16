// songs.ts — the songbook: a song's row, its texts, who sees it and who starred it. Its sheets,
// reference track and instrumental are songMedia.ts.

import { randomUUID } from "node:crypto";
import type {
  FetchStatus,
  LyricTiming,
  SongListEntry,
} from "@studio/rehearsal-shared";
import { compareSongEntries } from "@studio/rehearsal-shared/songList";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import { serialized } from "../lock.ts";
import type { FieldsOf } from "../schema.ts";
import { ROW_TTL_MS, rowCache } from "./helpers.ts";

export type SongRow = Row<"Songs">;

/** One sheet as SheetMeta stores it: its public id, the attachment holding its bytes, its name and type. */
export interface StoredSheet {
  id: string;
  attachmentId: string;
  name: string;
  mime: string;
}

const songCache = rowCache<SongRow | null>();

export async function getSongRecord(uid: string): Promise<SongRow | null> {
  const hit = songCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Songs", { Uid: [uid] });
  const rec = recs[0] || null;
  songCache.set(uid, { rec, exp: Date.now() + ROW_TTL_MS });
  return rec;
}

export function invalidateSong(uid: string): void {
  songCache.delete(uid);
}

/** The server a song was copied from, "" for one of this store's own — ../../docs/songbookCopy.md. */
export async function songOriginOf(uid: string): Promise<string> {
  const rec = await getSongRecord(uid);
  return rec ? String(rec.fields.Origin || "") : "";
}

export function sheetsOf(rec: {
  fields: { SheetMeta: string };
}): StoredSheet[] {
  // SheetMeta is a JSON array of { id, name, mime }, one per SheetFiles attachment, in order.
  try {
    const parsed = JSON.parse(rec.fields.SheetMeta || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The stored lyric timecodes, or none when the column is empty or unreadable — ../../../ui-rehearsal/docs/lyricsTiming.md. */
function timingsOf(rec: SongRow): LyricTiming[] {
  try {
    const parsed = JSON.parse(rec.fields.LyricTimings || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The song uids `ownerId` starred: a favourite is a person's, not the song's — ../../docs/ownership.md. */
async function favoritesOf(ownerId: string): Promise<Set<string>> {
  if (!ownerId) return new Set();
  const recs = await db.listRecords("SongFavorites", { OwnerId: [ownerId] });
  return new Set(recs.map((r) => String(r.fields.SongUid)));
}

/** A song as `viewer` sees it: everyone reads the same song, the star and `mine` are theirs. */
function publicSong(
  rec: SongRow,
  viewer = "",
  favorites: Set<string> = new Set(),
) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    mine: Boolean(viewer) && f.OwnerId === viewer,
    artist: f.Artist || "",
    title: f.Title || "",
    lyrics: f.Lyrics || "",
    lyricTimings: timingsOf(rec),
    tablature: f.Tablature || "",
    sheets: sheetsOf(rec).map((s) => ({
      id: s.id,
      name: s.name,
      mime: s.mime,
    })),
    // The library file the page streams from pl8 — k7 keeps no copy, ../../docs/audio.md.
    audio: libraryPath(f.AudioPath)
      ? { name: f.AudioName || "", mime: f.AudioMime || "", path: f.AudioPath }
      : null,
    // The same track without the voice, the one an engine's chain wrote beside the song's stems.
    instrumental: libraryPath(f.InstrumentalPath)
      ? {
          name: f.InstrumentalName || "",
          mime: f.InstrumentalMime || "",
          path: f.InstrumentalPath,
        }
      : null,
    // The auto-fetch pipeline's own state — fetchSong/run.ts's runPipeline reads and writes it.
    fetchStatus: {
      phase: (f.FetchPhase || "") as FetchStatus["phase"],
      progress: f.FetchProgress ? Number(f.FetchProgress) : null,
      error: f.FetchError || "",
      huntId: f.FetchHuntId || "",
      jobId: f.FetchJobId || "",
    },
    lyricsMatch: f.LyricsMatch || "",
    fetchIgnored: Boolean(f.FetchIgnored),
    private: Boolean(f.Private),
    origin: f.Origin || "",
    favorite: favorites.has(f.Uid),
    createdAt: f.CreatedAt || "",
  };
}

/** A song's track is a file of pl8's songs family or nothing: k7 stores, copies and plays no file of its own. */
export function libraryPath(p: unknown): string {
  const path = String(p || "");
  return path.startsWith("songs/") ? path : "";
}

/** A public song is everyone's to see; a private one is its creator's alone — ../../docs/ownership.md. */
function visibleTo(rec: SongRow, viewer: string): boolean {
  return !rec.fields.Private || rec.fields.OwnerId === viewer;
}

/** Whether `viewer` may reach the song at all: false for a missing one and for someone else's private one. */
export async function songVisibleTo(
  uid: string,
  viewer: string,
): Promise<boolean> {
  const rec = await getSongRecord(uid);
  return rec !== null && visibleTo(rec, viewer);
}

// What a songbook ROW shows: never the texts nor the envelope, which a whole songbook multiplies.
const SONG_LIST_FIELDS = [
  "Uid",
  "OwnerId",
  "Artist",
  "Title",
  "SheetMeta",
  "Private",
  "Origin",
  "CreatedAt",
];

/** Every song `viewer` may see as a songbook row — the public book and their own private songs — favourites first; a song's texts come from getSong. */
export async function listSongs(viewer = "") {
  const recs = db.listRecords("Songs", undefined, {
    fields: SONG_LIST_FIELDS,
    filled: ["Lyrics", "Tablature"],
  });
  const favorites = await favoritesOf(viewer);
  return recs
    .filter((rec) => visibleTo(rec, viewer))
    .map((rec) => songListEntry(rec, viewer, favorites))
    .sort(compareSongEntries);
}

/** A song as one songbook row: whether it has lyrics, a tablature, sheets, and never their content; the route adds canDelete. */
function songListEntry(
  rec: SongRow,
  viewer: string,
  favorites: Set<string>,
): Omit<SongListEntry, "canDelete"> {
  const f = rec.fields;
  return {
    id: f.Uid,
    mine: Boolean(viewer) && f.OwnerId === viewer,
    artist: f.Artist || "",
    title: f.Title || "",
    hasLyrics: Boolean(f.Lyrics),
    hasTablature: Boolean(f.Tablature),
    sheetCount: sheetsOf(rec).length,
    private: Boolean(f.Private),
    origin: f.Origin || "",
    favorite: favorites.has(f.Uid),
    createdAt: f.CreatedAt || "",
  };
}

export async function getSong(uid: string, viewer = "") {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  return publicSong(rec, viewer, await favoritesOf(viewer));
}

/** Star or unstar a song for `viewer` alone; null when there is no such song. */
async function setSongFavoriteUnlocked(
  uid: string,
  viewer: string,
  favorite: boolean,
) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
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
  {
    artist,
    title,
    private: hidden,
  }: { artist: string; title: string; private?: boolean },
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Songs", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Artist: artist,
      Title: title,
      Lyrics: "",
      Tablature: "",
      SheetMeta: "[]",
      Private: Boolean(hidden),
      CreatedAt: createdAt,
    },
  ]);
  invalidateSong(uid);
  return getSong(uid);
}

/** What an edit of a song may change; the fetch status field by field. */
interface SongPatch {
  artist?: string;
  title?: string;
  lyrics?: string;
  tablature?: string;
  lyricTimings?: LyricTiming[];
  fetchStatus?: Partial<FetchStatus>;
  lyricsMatch?: string;
  fetchIgnored?: boolean;
}

export async function updateSong(uid: string, patch: SongPatch) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Songs">> = {};
  if (patch.artist !== undefined) fields.Artist = String(patch.artist);
  if (patch.title !== undefined) fields.Title = String(patch.title);
  if (patch.lyrics !== undefined) fields.Lyrics = String(patch.lyrics);
  if (patch.tablature !== undefined) fields.Tablature = String(patch.tablature);
  if (patch.lyricTimings !== undefined)
    fields.LyricTimings = JSON.stringify(patch.lyricTimings);
  if (patch.fetchStatus !== undefined) {
    const s = patch.fetchStatus;
    if (s.phase !== undefined) fields.FetchPhase = String(s.phase);
    if (s.progress !== undefined) fields.FetchProgress = s.progress ?? 0;
    if (s.error !== undefined) fields.FetchError = String(s.error);
    if (s.huntId !== undefined) fields.FetchHuntId = String(s.huntId);
    if (s.jobId !== undefined) fields.FetchJobId = String(s.jobId);
  }
  if (patch.lyricsMatch !== undefined)
    fields.LyricsMatch = String(patch.lyricsMatch);
  if (patch.fetchIgnored !== undefined)
    fields.FetchIgnored = Boolean(patch.fetchIgnored);
  await db.patchRecord("Songs", rec.id, fields);
  invalidateSong(uid);
  return getSong(uid);
}

export async function deleteSong(uid: string): Promise<boolean> {
  const rec = await getSongRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("Songs", [rec.id]);
  invalidateSong(uid);
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
