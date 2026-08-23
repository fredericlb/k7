// mediatek.ts — where a session's bytes live: the médiathèque's RECORDINGS zone, over HTTP.
// Grist keeps the metadata (duration, envelope, gain, moments) and no longer carries the audio.
// The client is the package's, not a second one written here. See docs/audio.md.

import {
  pushRecording,
  pushSong,
  type RemoteConfig,
  remoteLibrary,
  remoteWriter,
} from "@studio/mediatek/remote";
import { env } from "./env.ts";

const cfg = (): RemoteConfig => ({
  base: env.mediatek.base,
  token: env.mediatek.token,
});

/** The extension the médiathèque will accept these bytes under. `mp4` is the trap: Safari records
 *  `audio/mp4`, which the zone files as VIDEO and refuses — a mp4 with no picture is a `.m4a`. */
export function zoneExt(ext: string): string {
  return ext === "mp4" ? "m4a" : ext;
}

/** Push a recording; the médiathèque picks the name. `at` is when the session was RECORDED, not
 *  when it was uploaded — otherwise one fetched the next day files under the wrong date. */
export async function push(
  bytes: Uint8Array,
  ext: string,
  at?: Date,
): Promise<string> {
  const { path } = await pushRecording(cfg(), {
    filename: `take.${zoneExt(ext)}`,
    bytes,
    at,
  });
  return path;
}

/** Push a MOMENT: the same day folder as recordings, named as an excerpt. `at` is when it was
 *  PLAYED — session start plus its offset — not when somebody annotated it days later. */
export async function pushMoment(
  bytes: Uint8Array,
  ext: string,
  opts: { at?: Date; durationSec: number; label?: string },
): Promise<string> {
  const { path } = await pushRecording(cfg(), {
    filename: `moment.${zoneExt(ext)}`,
    bytes,
    at: opts.at,
    durationSec: opts.durationSec,
    label: opts.label,
  });
  return path;
}

/**
 * Push a PUBLISHED version into the songs, under the `K7` artist.
 *
 * `songs/` no longer files by provenance, so a published version lands exactly where a manual
 * upload does; `source: k7` in the sidecar is what says where it came from. `replace` is true
 * because republishing is a deliberate overwrite — the 409 protects a person uploading twice,
 * not a service republishing.
 */
export async function pushVersion(
  bytes: Uint8Array,
  ext: string,
  tags: { album: string; title: string },
): Promise<string> {
  // The MASTER's path, not the folder's: it is what a caller has to fetch to play the
  // version, and the folder is one `dirname` away when the stems need it.
  const { master } = await pushSong(cfg(), {
    filename: `mixdown.${zoneExt(ext)}`,
    bytes,
    artist: ARTIST,
    album: tags.album,
    title: tags.title,
    source: "k7",
    replace: true,
  });
  return master;
}

/** The one artist k7 publishes under: the zone files by artist, and who played is release
 *  metadata rather than a folder name. */
export const ARTIST = "K7";

/** Write a file at a chosen path — a version's stems, a sidecar a rename made wrong. Reserved
 *  for what this service created itself. */
export async function putFile(
  path: string,
  body: Uint8Array | string,
): Promise<void> {
  await remoteWriter(cfg()).put(path, body);
}

/** A whole folder — which is what a published version is: a master, its stems, its sidecar. */
export async function removeTree(path: string): Promise<void> {
  await remoteWriter(cfg()).removeTree(path);
}

/** Overwrite an EXISTING recording in place: a session being extended is still one session, and
 *  a second file would leave two takes where there is one recording. */
export async function replace(path: string, bytes: Uint8Array): Promise<void> {
  await remoteWriter(cfg()).put(path, bytes);
}

/** Already gone counts as success, on the médiathèque's side and here. */
export async function remove(path: string): Promise<void> {
  await remoteWriter(cfg()).remove(path);
}

/** Fetch the bytes into the disk cache, which is what serves Range requests. */
export async function download(path: string, dest: string): Promise<void> {
  await remoteLibrary(cfg()).download(path, dest);
}
