// songFetch.ts — a songbook song's track and instrumental LINKED to pl8's library instead of uploaded:
// k7 keeps no copy, the page streams them from pl8. The page finds the song, hunts it and cuts its stems
// as the user; this side only checks the paths and links them — ../../docs/audio.md.

import { mimeFor } from "@studio/mediatek/media";
import * as store from "./store.ts";

// What an engine's instrumental chain writes beside a song's stems.
const INSTRUMENTAL_FILE = "instrumental.wav";

/** A library path this side refuses: outside the songs family, or not audio. */
export class LibraryPathError extends Error {}

/** `p` as a path inside pl8's songs family, or a LibraryPathError. */
function songsPath(p: string): string {
  const clean = String(p).replace(/^\/+|\/+$/g, "");
  if (!clean.startsWith("songs/") || clean.split("/").includes(".."))
    throw new LibraryPathError(`not a song of the library: ${p}`);
  return clean;
}

/** Link a song to a library master as its reference track; null when there is no such song. */
export async function linkLibraryTrack(uid: string, libraryFile: string) {
  const song = await store.getSong(uid);
  if (!song) return null;
  const source = songsPath(libraryFile);
  const mime = mimeFor(source);
  if (!mime.startsWith("audio/"))
    throw new LibraryPathError(`not an audio file: ${source}`);
  return store.linkSongAudio(uid, {
    path: source,
    mime,
    name: `${song.artist} - ${song.title}`,
  });
}

/** Link the instrumental an engine's chain wrote beside a library song's stems; null when there is no such song. */
export async function linkLibraryInstrumental(uid: string, songFolder: string) {
  const song = await store.getSong(uid);
  if (!song) return null;
  const folder = songsPath(songFolder);
  return store.linkSongInstrumental(uid, {
    path: `${folder}/stems/${INSTRUMENTAL_FILE}`,
    mime: "audio/wav",
    name: `${song.artist} - ${song.title} (instrumental)`,
  });
}
