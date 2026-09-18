// songFetch.ts — a songbook song's track and instrumental, copied out of pl8's library instead of uploaded.
// The page finds the song, hunts it on Soulseek and cuts its stems as the user; this side only copies
// and mixes, with k7's own token — ../../docs/audio.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mimeFor } from "@studio/mediatek/media";
import {
  INSTRUMENTAL_FILE,
  INSTRUMENTAL_STEMS,
  mixStems,
  toFlac,
} from "./instrumentalMix.ts";
import * as mediatek from "./mediatek.ts";
import * as store from "./store.ts";

/** A library path this side refuses: outside the songs family, or not audio. */
export class LibraryPathError extends Error {}

/** `p` as a path inside pl8's songs family, or a LibraryPathError. */
function songsPath(p: string): string {
  const clean = String(p).replace(/^\/+|\/+$/g, "");
  if (!clean.startsWith("songs/") || clean.split("/").includes(".."))
    throw new LibraryPathError(`not a song of the library: ${p}`);
  return clean;
}

/** Run `fn` in a fresh temporary folder, removed whatever happens. */
async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k7-fetch-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Copy a song's master out of pl8's library as its reference track; null when there is no such song. */
export async function copyLibraryTrack(uid: string, libraryFile: string) {
  const song = await store.getSong(uid);
  if (!song) return null;
  const source = songsPath(libraryFile);
  const mime = mimeFor(source);
  if (!mime.startsWith("audio/"))
    throw new LibraryPathError(`not an audio file: ${source}`);
  return inTemp(async (dir) => {
    const local = path.join(dir, path.basename(source));
    await mediatek.download(source, local);
    return store.setSongAudio(uid, {
      buffer: fs.readFileSync(local),
      mime,
      name: `${song.artist} - ${song.title}${path.extname(source)}`,
    });
  });
}

/** Take the instrumental beside a library song and keep it with the songbook song; null when there is no such song. */
export async function mixLibraryInstrumental(uid: string, songFolder: string) {
  const song = await store.getSong(uid);
  if (!song) return null;
  const folder = songsPath(songFolder);
  return inTemp(async (dir) => {
    const out = path.join(dir, "instrumental.flac");
    await instrumentalInto(folder, dir, out);
    return store.setSongInstrumental(uid, {
      buffer: fs.readFileSync(out),
      mime: "audio/flac",
      name: `${song.artist} - ${song.title} (instrumental).flac`,
    });
  });
}

/** The instrumental a chain wrote, else the three stems summed here — an older folder has no such file. */
async function instrumentalInto(
  folder: string,
  dir: string,
  out: string,
): Promise<void> {
  const whole = path.join(dir, INSTRUMENTAL_FILE);
  try {
    await mediatek.download(`${folder}/stems/${INSTRUMENTAL_FILE}`, whole);
    return toFlac(whole, out);
  } catch {
    // No instrumental beside the stems: this song was cut before a chain made one.
  }
  const inputs: string[] = [];
  for (const stem of INSTRUMENTAL_STEMS) {
    const local = path.join(dir, `${stem}.wav`);
    await mediatek.download(`${folder}/stems/${stem}.wav`, local);
    inputs.push(local);
  }
  return mixStems(inputs, out);
}
