// mediatek.ts — where a session's bytes live: the médiathèque's RECORDINGS zone, over HTTP.
// PocketBase keeps the metadata (duration, envelope, gain, moments) and carries no audio at all.
// The client is the package's, not a second one written here. See docs/audio.md.

import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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

/** The extension the zone accepts these bytes under; `mp4` is the trap (../../docs/audio.md). */
export function zoneExt(ext: string): string {
  return ext === "mp4" ? "m4a" : ext;
}

/** Push a recording; the zone picks the name. `at` is when it was RECORDED, not uploaded. */
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

/** Push a MOMENT into the same day folder, named as an excerpt; `at` is when it was PLAYED. */
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

/** Push a PUBLISHED version into the songs, under the `K7` artist — ../../docs/audio.md. */
export async function pushVersion(
  bytes: Uint8Array,
  ext: string,
  tags: { album: string; title: string },
): Promise<string> {
  // The MASTER's path, not the folder's: the folder is one `dirname` away when stems need it.
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

/** The one artist k7 publishes under; who actually played is release metadata. */
export const ARTIST = "K7";

/** Write a file at a chosen path, reserved for what this service created itself. */
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

/** Overwrite an EXISTING recording in place: an extended session is still one session. */
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

/**
 * Like `download`, but through pl8's `/stream` — a FLAC source lands on disk as its MP3
 * transcode, anything else unchanged. For a path a browser will PLAY, never one this app
 * re-uploads or re-processes: `download` still owns that case, byte-exact.
 */
export async function downloadStreamable(
  path: string,
  dest: string,
): Promise<void> {
  const { base, token } = cfg();
  const res = await fetch(
    `${base.replace(/\/+$/, "")}/api/mediatek/stream?path=${encodeURIComponent(path)}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok || !res.body)
    throw new Error(`mediatek stream ${path}: ${res.status} ${res.statusText}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** What a médiathèque path will actually stream as — pl8 transcodes only a FLAC source. */
export function streamedMime(remotePath: string, storedMime: string): string {
  return remotePath.toLowerCase().endsWith(".flac") ? "audio/mpeg" : storedMime;
}

export interface RemoteEnvelope {
  sampleRate: number;
  seconds: number;
  rms: number[];
  transients: number[];
}

/** pl8's own measurement of a médiathèque path — computed once there, kept in its cache. */
export async function getFileEnvelope(path: string): Promise<RemoteEnvelope> {
  const { base, token } = cfg();
  const res = await fetch(
    `${base.replace(/\/+$/, "")}/api/mediatek/envelope?path=${encodeURIComponent(path)}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok)
    throw new Error(
      `mediatek envelope ${path}: ${res.status} ${res.statusText}`,
    );
  return res.json() as Promise<RemoteEnvelope>;
}
