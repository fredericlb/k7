// songMedia.ts — what a song carries beside its texts: its sheets, kept here, and its reference
// track and instrumental, which are LINKS to files of the médiathèque, never copies (../../docs/audio.md).

import fs from "node:fs";
import type { SongEnvelope } from "@studio/rehearsal-shared";
import * as db from "../db.ts";
import { serialized } from "../lock.ts";
import * as mediatek from "../mediatek.ts";
import { audioExtOf } from "../serve.ts";
import { envelopeOf } from "../songEnvelope.ts";
import {
  getSong,
  getSongRecord,
  invalidateSong,
  libraryPath,
  type SongRow,
  type StoredSheet,
  sheetsOf,
} from "./songs.ts";

/** A track a song links to: where it is in the médiathèque, and how it reads. */
interface TrackLink {
  path: string;
  mime: string;
  name: string;
}

// --- Song sheets (PDF / image / MusicXML files — not audio, so the store keeps them) -------

// SheetMeta is the order, name and type; the bytes live in the song_sheets collection.
async function writeSheets(rec: SongRow, sheets: StoredSheet[]): Promise<void> {
  await db.patchRecord("Songs", rec.id, {
    SheetMeta: JSON.stringify(sheets),
  });
}

// Upload { file, mime, name } files — each a path on disk, copied in — onto a song's sheet, after the existing ones.
async function addSheetFilesUnlocked(
  uid: string,
  files: { file: string; mime: string; name: string }[],
) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const existing = sheetsOf(rec);
  const added: StoredSheet[] = [];
  for (const file of files) {
    const name = file.name || "sheet";
    const attachmentId = await db.uploadAttachment(
      { file: file.file },
      file.mime,
      name,
      rec.id,
    );
    added.push({ id: attachmentId, attachmentId, name, mime: file.mime });
  }
  await writeSheets(rec, [...existing, ...added]);
  invalidateSong(uid);
  return getSong(uid);
}

// Remove a single sheet file (by its public id) from a song.
async function deleteSheetFileUnlocked(uid: string, fileId: string) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const existing = sheetsOf(rec);
  const gone = existing.find((s) => s.id === fileId);
  if (!gone) return getSong(uid);
  await writeSheets(
    rec,
    existing.filter((s) => s.id !== fileId),
  );
  try {
    db.deleteAttachment(gone.attachmentId);
  } catch {
    // The metadata row is what the songbook reads; a stray blob left behind is not fatal.
  }
  invalidateSong(uid);
  return getSong(uid);
}

/** A sheet's file on disk, where the store keeps it, so it can be streamed. */
export async function ensureSheetFileCached(uid: string, fileId: string) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const entry = sheetsOf(rec).find((s) => s.id === fileId);
  if (!entry) return null;
  const filePath = db.attachmentFile(entry.attachmentId);
  return filePath ? { filePath, mime: entry.mime, name: entry.name } : null;
}

/** Point the song at a library master; the browser streams it from pl8 — ../../docs/audio.md. */
export async function linkSongAudio(
  uid: string,
  { path: master, mime, name }: TrackLink,
) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const previous = rec.fields.AudioPath ? String(rec.fields.AudioPath) : "";
  await db.patchRecord("Songs", rec.id, {
    AudioPath: master,
    AudioMime: mime,
    AudioName: name,
    // Another track has another shape; the next reader measures this one.
    Envelope: "",
  });
  // An instrumental made from the old track is not this track's.
  if (previous !== master) await clearInstrumental(rec);
  invalidateSong(uid);
  return getSong(uid);
}

/** An uploaded track goes INTO the library, as this song, and the song links to it. */
export async function setSongAudio(
  uid: string,
  { file, mime, name }: { file: string; mime: string; name: string },
) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const artist = String(rec.fields.Artist || "");
  const title = String(rec.fields.Title || "");
  const master = await mediatek.pushSongTrack(await fs.openAsBlob(file), {
    filename: `${artist} - ${title}.${songAudioExt(mime, name)}`,
    artist,
    title,
    songUid: uid,
  });
  return linkSongAudio(uid, { path: master, mime, name });
}

/** Common audio containers, then the uploaded name's own extension, then `bin`. */
function songAudioExt(mime: string, name: string): string {
  const known = audioExtOf(mime);
  if (known) return known;
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return fromName ? fromName[1].toLowerCase() : "bin";
}

/** The song stops pointing at its library track and instrumental; the library keeps both files. */
export async function unlinkSongAudio(uid: string) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await db.patchRecord("Songs", rec.id, {
    AudioPath: "",
    AudioMime: "",
    AudioName: "",
    Envelope: "",
  });
  await clearInstrumental(rec);
  invalidateSong(uid);
  return getSong(uid);
}

// --- The instrumental: the one an engine's chain wrote beside the library song's stems ------------

/** Forget a song's instrumental link — also what a new track calls; the library keeps the file. */
async function clearInstrumental(rec: SongRow): Promise<void> {
  if (!rec.fields.InstrumentalPath) return;
  await db.patchRecord("Songs", rec.id, {
    InstrumentalPath: "",
    InstrumentalMime: "",
    InstrumentalName: "",
  });
}

export async function linkSongInstrumental(
  uid: string,
  { path: file, mime, name }: TrackLink,
) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await db.patchRecord("Songs", rec.id, {
    InstrumentalPath: file,
    InstrumentalMime: mime,
    InstrumentalName: name,
  });
  invalidateSong(uid);
  return getSong(uid);
}

export async function deleteSongInstrumental(uid: string) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await clearInstrumental(rec);
  invalidateSong(uid);
  return getSong(uid);
}

/** The track's shape, measured on first ask and kept: decoding is seconds, drawing must not be. */
export async function songEnvelope(uid: string): Promise<SongEnvelope | null> {
  const rec = await getSongRecord(uid);
  const track = libraryPath(rec?.fields.AudioPath);
  if (!rec || !track) return null;
  const stored = String(rec.fields.Envelope || "");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SongEnvelope;
      if (parsed?.samples?.length) return parsed;
    } catch {
      // Unreadable is the same as absent: measure it again rather than refuse to draw.
    }
  }
  // pl8 already holds the bytes and measures them — no local download needed.
  const measured = await envelopeOf(track);
  await db.patchRecord("Songs", rec.id, {
    Envelope: JSON.stringify(measured),
  });
  invalidateSong(uid);
  return measured;
}

// One at a time per key — a read-modify-write here has no transaction to lean on (../lock.ts).

export function addSheetFiles(
  ...args: Parameters<typeof addSheetFilesUnlocked>
) {
  return serialized(`sheets:${args[0]}`, () => addSheetFilesUnlocked(...args));
}

export function deleteSheetFile(
  ...args: Parameters<typeof deleteSheetFileUnlocked>
) {
  return serialized(`sheets:${args[0]}`, () =>
    deleteSheetFileUnlocked(...args),
  );
}
