// mediatek.ts — where a session's bytes live: the médiathèque's RECORDINGS zone, over HTTP.
// The store keeps the metadata (duration, envelope, gain, moments) and carries no audio at all.
// The client is the package's, not a second one written here. See ../docs/audio.md.

import {
  pushRecording,
  pushSong,
  putTags as putRemoteTags,
  type RemoteConfig,
  type RemoteEnvelope,
  remoteLibrary,
  remoteSongbook,
  remoteWriter,
} from "@studio/mediatek/remote";
import { segment } from "@studio/mediatek/song";
import { K7_ARTIST } from "@studio/mediatek/types";
import { audioMimeOf } from "./serve.ts";

// Handed in by the host at mount time: the library is served by the same process, over loopback.
let link: RemoteConfig | undefined;

/** Point every push and fetch below at the host's library; mountRehearsal calls it once. */
export function linkMediatek(cfg: RemoteConfig): void {
  link = cfg;
}

function cfg(): RemoteConfig {
  if (!link)
    throw new Error(
      "the media library is not linked — mountRehearsal was not called",
    );
  return link;
}

/** The extension the zone accepts these bytes under; `mp4` is the trap (../docs/audio.md). */
export function zoneExt(ext: string): string {
  return ext === "mp4" ? "m4a" : ext;
}

/** Push a recording; the zone picks the name. `at` is when it was RECORDED, not uploaded. */
export async function push(
  bytes: Uint8Array | Blob,
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
  bytes: Uint8Array | Blob,
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

/** The suffix that makes a folder this row's alone: a uid's first eight characters. */
export const uidTag = (uid: string): string => ` (${String(uid).slice(0, 8)})`;

/** A readable name carrying its row's tag, cut short enough that the library's 80-character cap keeps the tag. */
export const tagged = (name: string, uid: string, fallback: string): string =>
  `${segment(name, fallback).slice(0, 60)}${uidTag(uid)}`;

/** Push a PUBLISHED version into the songs, under the `K7` artist, in a folder its uids make its own — ../docs/audio.md. */
export async function pushVersion(
  bytes: Uint8Array | Blob,
  ext: string,
  tags: {
    album: string;
    title: string;
    releaseUid: string;
    versionUid: string;
  },
): Promise<string> {
  // The MASTER's path, not the folder's: the folder is one `dirname` away when stems need it.
  const { master } = await pushSong(cfg(), {
    filename: `mixdown.${zoneExt(ext)}`,
    bytes,
    artist: K7_ARTIST,
    album: tagged(tags.album, tags.releaseUid, "Release"),
    title: tagged(tags.title, tags.versionUid, "Version"),
    source: "k7",
    replace: true,
  });
  return master;
}

/** Write a file at a chosen path, reserved for what this service created itself: an extended session overwrites its recording this way. */
export async function putFile(
  path: string,
  body: Uint8Array | Blob | string,
): Promise<void> {
  await remoteWriter(cfg()).put(path, body);
}

/** Rename a published version where the library lists it: its master's tags, the folder untouched (../docs/audio.md). */
export async function putTags(
  folder: string,
  tags: { title: string; artist: string; album: string },
): Promise<void> {
  await putRemoteTags(cfg(), folder, tags);
}

/** A whole folder — which is what a published version is: a master, its stems, its sidecar. */
export async function removeTree(path: string): Promise<void> {
  await remoteWriter(cfg()).removeTree(path);
}

/** Already gone counts as success, on the médiathèque's side and here. */
export async function remove(path: string): Promise<void> {
  await remoteWriter(cfg()).remove(path);
}

/** Fetch the bytes into the disk cache, which is what serves Range requests. */
export async function download(path: string, dest: string): Promise<void> {
  await remoteLibrary(cfg()).download(path, dest);
}

/** Like `download`, through `/stream`: for a path a browser will PLAY, never one this app re-uploads, which `download` keeps byte-exact. */
export async function downloadStreamable(
  path: string,
  dest: string,
): Promise<void> {
  await remoteLibrary(cfg()).stream(path, dest);
}

/** What a médiathèque path will actually stream as, read off the path the server filed — pl8 streams a FLAC as Opus in WebM. */
export function streamedMime(remotePath: string): string {
  return remotePath.toLowerCase().endsWith(".flac")
    ? "audio/webm"
    : audioMimeOf(remotePath);
}

/** The songbook as the library keeps it — a song's texts and sheets in its folder (packages/mediatek/docs/songbook.md). */
export function songbook(): ReturnType<typeof remoteSongbook> {
  return remoteSongbook(cfg());
}

/** The library's own measurement of a médiathèque path — computed once there, kept in its cache. */
export async function getFileEnvelope(path: string): Promise<RemoteEnvelope> {
  return remoteLibrary(cfg()).envelope(path);
}
