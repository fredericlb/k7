// songMedia.ts — what a song carries beside its texts: its sheets, its reference track and its
// instrumental, all in the song's library folder (packages/mediatek/docs/songbook.md). The
// reference track IS the folder's master; linking another library track moves the song there.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SongEnvelope } from "@studio/rehearsal-shared";
import { serialized } from "../lock.ts";
import * as mediatek from "../mediatek.ts";
import { audioExtOf } from "../serve.ts";
import { envelopeOf } from "../songEnvelope.ts";
import { CACHE_DIR, fetching } from "./helpers.ts";
import { getSong } from "./songs.ts";

/** A track a song links to: where it is in the médiathèque, and how it reads. */
interface TrackLink {
  path: string;
  mime: string;
  name: string;
}

// --- Song sheets (PDF / image / score files), in the song's `sheets/` --------------------

// Upload { file, mime, name } files — each a path on disk — onto a song's sheet, after the existing ones.
async function addSheetFilesUnlocked(
  uid: string,
  files: { file: string; mime: string; name: string }[],
) {
  if (!(await getSong(uid))) return null;
  for (const file of files)
    await mediatek.songbook().addSheet(uid, await fs.openAsBlob(file.file), {
      name: file.name || "sheet",
      mime: file.mime,
    });
  return getSong(uid);
}

// Remove a single sheet file (by its public id) from a song.
async function deleteSheetFileUnlocked(uid: string, fileId: string) {
  if (!(await getSong(uid))) return null;
  await mediatek.songbook().removeSheet(uid, fileId);
  return getSong(uid);
}

/** A sheet's bytes on this disk, fetched from the library once: a sheet file never changes under its name. */
export async function ensureSheetFileCached(uid: string, fileId: string) {
  const song = await mediatek.songbook().get(uid);
  const sheet = song?.facts.sheets.find((s) => s.id === fileId);
  if (!song || !sheet) return null;
  const remote = `${song.path}/${sheet.file}`;
  const key = createHash("sha1").update(remote).digest("hex");
  const filePath = path.join(CACHE_DIR, "sheets", key);
  if (!fs.existsSync(filePath)) {
    // One download per file however many readers ask at once.
    let pending = fetching.get(filePath);
    if (!pending) {
      pending = mediatek
        .download(remote, filePath)
        .finally(() => fetching.delete(filePath));
      fetching.set(filePath, pending);
    }
    await pending;
  }
  return { filePath, mime: sheet.mime, name: sheet.name };
}

/** Make a library track the song's own: the song moves into that track's folder — ../../docs/audio.md. */
export async function linkSongAudio(uid: string, { path: master }: TrackLink) {
  const folder = master.split("/").slice(0, -1).join("/");
  if (!(await mediatek.songbook().move(uid, folder))) return null;
  return getSong(uid);
}

/** An uploaded track goes INTO the library, as the master of the song's own folder. */
export async function setSongAudio(
  uid: string,
  { file, mime, name }: { file: string; mime: string; name: string },
) {
  const song = await getSong(uid);
  if (!song) return null;
  await mediatek
    .songbook()
    .setMaster(
      uid,
      await fs.openAsBlob(file),
      `${song.artist} - ${song.title}.${songAudioExt(mime, name)}`,
    );
  return getSong(uid);
}

/** Common audio containers, then the uploaded name's own extension, then `bin`. */
function songAudioExt(mime: string, name: string): string {
  const known = audioExtOf(mime);
  if (known) return known;
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return fromName ? fromName[1].toLowerCase() : "bin";
}

/** The song leaves its track and instrumental behind, for a folder of its own; the library keeps both files. */
export async function unlinkSongAudio(uid: string) {
  if (!(await getSong(uid))) return null;
  await mediatek.songbook().patch(uid, { instrumental: "" });
  await mediatek.songbook().detach(uid);
  return getSong(uid);
}

// --- The instrumental: the one an engine's chain wrote beside the library song's stems ------------

export async function linkSongInstrumental(
  uid: string,
  { path: file }: TrackLink,
) {
  if (!(await mediatek.songbook().patch(uid, { instrumental: file })))
    return null;
  return getSong(uid);
}

export async function deleteSongInstrumental(uid: string) {
  if (!(await mediatek.songbook().patch(uid, { instrumental: "" })))
    return null;
  return getSong(uid);
}

/** The track's shape, measured by the library, which keeps it beside the file. */
export async function songEnvelope(uid: string): Promise<SongEnvelope | null> {
  const song = await mediatek.songbook().get(uid);
  return song?.master ? envelopeOf(song.master) : null;
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
