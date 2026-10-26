// versions.ts — a release's versions: each one a song of the médiathèque under songs/K7/, its
// mixdown the master and its stems beside it, in a folder its uids make its own (../../docs/audio.md).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { segment } from "@studio/mediatek/song";
import { K7_ARTIST } from "@studio/mediatek/types";
import type { SongEnvelope } from "@studio/rehearsal-shared";
import { cachedFile, once } from "../cache.ts";
import * as db from "../db.ts";
import * as mediatek from "../mediatek.ts";
import { envelopeOf, hasPeak } from "../songEnvelope.ts";
import { dirOf, fetching, safeRemote, safeUnlink } from "./helpers.ts";
import {
  getReleaseRecord,
  getVersionRecords,
  invalidateVersions,
  type StoredTrack,
  tracksOf,
  type UploadedAudio,
  type VersionRow,
  versionCachePath,
  versionExt,
  versionOf,
  versionTrackCachePath,
} from "./releaseRows.ts";

// A version carries a mixdown and, optionally, per-track stems; a web upload passes none.
export async function addVersion(
  releaseUid: string,
  { name, isDefault }: { name?: string; isDefault?: boolean },
  mixdown: UploadedAudio,
  tracks: UploadedAudio[] = [],
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  const versionName = name || "Version";

  // A published version becomes a song under songs/K7/ — see ../../docs/audio.md.
  const release = await getReleaseRecord(releaseUid);
  const master = await mediatek.pushVersion(
    await fs.openAsBlob(mixdown.file),
    versionExt(mixdown.mime),
    {
      album: release?.fields.Title || "",
      title: versionName,
      releaseUid,
      versionUid: uid,
    },
  );

  // Stems go in a `stems/` subfolder, out of reach of the scan that picks the master.
  const folder = dirOf(master);
  const stems: StoredTrack[] = [];
  for (const [i, t] of tracks.entries()) {
    const entry = {
      id: String(i + 1),
      path: `${folder}/stems/${stemName(t, i)}`,
      name: t.name || `stem-${i + 1}`,
      mime: t.mime,
    };
    await mediatek.putFile(entry.path, await fs.openAsBlob(t.file));
    stems.push(entry);
    fs.renameSync(t.file, versionTrackCachePath(uid, entry));
  }

  await db.addRecords("Versions", [
    {
      Uid: uid,
      ReleaseUid: releaseUid,
      Name: versionName,
      AudioPath: master,
      AudioMime: mixdown.mime,
      TrackMeta: JSON.stringify(stems),
      IsDefault: false,
      CreatedAt: createdAt,
    },
  ]);
  seedVersionCache(mixdown, master, uid);
  invalidateVersions(releaseUid);

  const versions = await getVersionRecords(releaseUid);
  // First version, or explicitly requested, becomes the default.
  if (isDefault || versions.length === 1) {
    await setDefaultVersion(releaseUid, uid);
  }
  return {
    id: uid,
    name: name || "Version",
    isDefault: true,
    audioMime: mixdown.mime,
    tracks: stems.map((s) => ({ id: s.id, name: s.name, mime: s.mime })),
    createdAt,
  };
}

/** Whether a library folder is this version's own, named with its uid — ../../docs/audio.md. */
function ownsVersionFolder(folder: string, versionUid: string): boolean {
  return folder.endsWith(mediatek.uidTag(versionUid));
}

/** What this version put in the médiathèque, and nothing another version shares; never fatal. */
export async function forgetVersionFolder(v: VersionRow): Promise<void> {
  const master = String(v?.fields.AudioPath || "");
  if (!master) return;
  const folder = dirOf(master);
  if (ownsVersionFolder(folder, String(v.fields.Uid))) {
    await mediatek.removeTree(folder).catch(() => {});
    return;
  }
  // A folder named by title alone may hold another version's bytes: only files no other row names go.
  const named = await pathsOfOtherVersions(String(v.fields.Uid));
  for (const p of [master, ...tracksOf(v).map((t) => String(t.path || ""))])
    if (p && !named.has(p)) await safeRemote(p);
}

/** Every library path a version other than `versionUid` points at. */
async function pathsOfOtherVersions(versionUid: string): Promise<Set<string>> {
  const recs = await db.listRecords("Versions", undefined, {
    fields: ["Uid", "AudioPath", "TrackMeta"],
  });
  const paths = new Set<string>();
  for (const r of recs) {
    if (r.fields.Uid === versionUid) continue;
    paths.add(String(r.fields.AudioPath || ""));
    for (const t of tracksOf(r)) paths.add(String(t.path || ""));
  }
  return paths;
}

export async function setDefaultVersion(
  releaseUid: string,
  versionUid: string,
): Promise<true | null> {
  const versions = await getVersionRecords(releaseUid);
  const target = versions.find((v) => v.fields.Uid === versionUid);
  if (!target) return null;
  // One default at a time: the flags all move in one transaction.
  db.inTransaction(() => {
    for (const v of versions) {
      const shouldBe = v.fields.Uid === versionUid;
      if (Boolean(v.fields.IsDefault) !== shouldBe)
        db.patchRecord("Versions", v.id, { IsDefault: shouldBe });
    }
  });
  invalidateVersions(releaseUid);
  return true;
}

/** Hidden keeps a version out of a page's dropdown, and a page that chose it falls back to the default. */
export async function setVersionHidden(
  releaseUid: string,
  versionUid: string,
  hidden: unknown,
): Promise<true | null> {
  const v = await versionOf(releaseUid, versionUid);
  if (!v) return null;
  await db.patchRecord("Versions", v.id, { Hidden: Boolean(hidden) });
  invalidateVersions(releaseUid);
  return true;
}

export async function renameVersion(
  releaseUid: string,
  versionUid: string,
  name: string,
): Promise<true | null> {
  const v = await versionOf(releaseUid, versionUid);
  if (!v) return null;
  await db.patchRecord("Versions", v.id, { Name: String(name) });
  // The folder keeps its name and only the master's tags are rewritten — ../../docs/audio.md.
  if (v.fields.AudioPath) {
    const release = await getReleaseRecord(releaseUid);
    const folder = dirOf(v.fields.AudioPath);
    const own = ownsVersionFolder(folder, versionUid);
    const album = String(release?.fields.Title || "");
    await mediatek
      .putTags(folder, {
        title: own
          ? mediatek.tagged(String(name), versionUid, "Version")
          : String(name),
        artist: K7_ARTIST,
        album: own ? mediatek.tagged(album, releaseUid, "Release") : album,
      })
      .catch(() => {
        // A stale title in the library is worth less than a rename that fails.
      });
  }
  invalidateVersions(releaseUid);
  return true;
}

export async function deleteVersion(
  releaseUid: string,
  versionUid: string,
): Promise<boolean> {
  const v = await versionOf(releaseUid, versionUid);
  if (!v) return false;
  await forgetVersionFolder(v);
  await db.deleteRecords("Versions", [v.id]);
  dropVersionCache(versionUid, String(v.fields.AudioPath ?? ""));
  for (const t of tracksOf(v)) safeUnlink(versionTrackCachePath(versionUid, t));
  invalidateVersions(releaseUid);
  // If we removed the default, promote the most recent remaining version.
  if (v.fields.IsDefault) {
    const remaining = (await getVersionRecords(releaseUid)).sort((a, b) =>
      String(b.fields.CreatedAt).localeCompare(String(a.fields.CreatedAt)),
    );
    if (remaining[0])
      await setDefaultVersion(releaseUid, remaining[0].fields.Uid);
  }
  return true;
}

// One measurement per version at a time, however many visitors ask for it together (../cache.ts).
const measuring = new Map<string, Promise<SongEnvelope | null>>();

/** A version's shape, measured on first ask and kept: decoding is seconds, drawing must not be — and asked ONCE however many visitors arrive together. */
export function versionEnvelope(
  releaseUid: string,
  versionUid: string,
): Promise<SongEnvelope | null> {
  return once(measuring, versionUid, () =>
    measureVersionEnvelope(releaseUid, versionUid),
  );
}

async function measureVersionEnvelope(
  releaseUid: string,
  versionUid: string,
): Promise<SongEnvelope | null> {
  const rec = await versionOf(releaseUid, versionUid);
  if (!rec?.fields.AudioPath) return null;
  const stored = String(rec.fields.Envelope || "");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SongEnvelope;
      // An RMS-only shape is measured again, so every waveform is drawn the same way.
      if (parsed?.samples?.length && hasPeak(parsed)) return parsed;
    } catch {
      // Unreadable is the same as absent: measure it again rather than refuse to draw.
    }
  }
  // pl8 measures its own copy, so it is asked by library path — never by our local cache file.
  const measured = await envelopeOf(String(rec.fields.AudioPath));
  await db.patchRecord("Versions", rec.id, {
    Envelope: JSON.stringify(measured),
  });
  invalidateVersions(releaseUid);
  return measured;
}

export async function ensureVersionAudioCached(
  releaseUid: string,
  versionUid: string,
): Promise<{ filePath: string; mime: string } | null> {
  const rec = await versionOf(releaseUid, versionUid);
  if (!rec?.fields.AudioPath) return null;
  const remote = String(rec.fields.AudioPath);
  const mime = mediatek.streamedMime(remote);
  const filePath = versionCachePath(versionUid, mime);
  if (!cachedFile(filePath))
    await once(fetching, filePath, () =>
      mediatek.downloadStreamable(remote, filePath),
    );
  return { filePath, mime };
}

/** The uploaded mixdown as the version's cache, when it is what `/stream` would serve; a FLAC is streamed as Opus, so it is dropped. */
export function seedVersionCache(
  mixdown: { file: string; mime: string },
  remote: string,
  versionUid: string,
): void {
  const mime = mediatek.streamedMime(remote);
  if (mime === mixdown.mime)
    fs.renameSync(mixdown.file, versionCachePath(versionUid, mime));
  else safeUnlink(mixdown.file);
}

/** The cached mixdown of a version whose médiathèque file is `remote`. */
export function dropVersionCache(versionUid: string, remote: string): void {
  if (remote)
    safeUnlink(versionCachePath(versionUid, mediatek.streamedMime(remote)));
}

/** "Artist - Title (Version).ext": what a downloaded version is saved as. */
export function versionFileName(
  release: { artist: string; title: string },
  version: { name: string },
  mime: string,
): string {
  return `${release.artist} - ${release.title} (${version.name}).${versionExt(mime)}`;
}

/** A stem's file name under `stems/`: its own name, made nameable, plus its extension. */
function stemName(track: UploadedAudio, i: number): string {
  const stem = segment(track.name || "", `stem-${i + 1}`);
  return `${stem}.${versionExt(track.mime)}`;
}

/** A version's stem on disk, fetched from the médiathèque; { filePath, mime, name } or null. */
export async function ensureVersionTrackCached(
  releaseUid: string,
  versionUid: string,
  trackId: string,
): Promise<{ filePath: string; mime: string; name: string } | null> {
  const rec = await versionOf(releaseUid, versionUid);
  if (!rec) return null;
  const entry = tracksOf(rec).find((t) => t.id === trackId);
  if (!entry?.path) return null;
  const mime = mediatek.streamedMime(entry.path);
  const filePath = versionTrackCachePath(versionUid, { ...entry, mime });
  if (!cachedFile(filePath))
    await once(fetching, filePath, () =>
      mediatek.downloadStreamable(entry.path, filePath),
    );
  return { filePath, mime, name: entry.name };
}
