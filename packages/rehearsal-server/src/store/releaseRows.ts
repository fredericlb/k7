// releaseRows.ts — a release's and its versions' rows as both halves read them: the short-lived
// caches, the mappers to what the API answers, and where a version's audio is cached on disk.

import path from "node:path";
import type { ReleaseVersion } from "@studio/rehearsal-shared";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import { audioExtOf } from "../serve.ts";
import { CACHE_DIR, ROW_TTL_MS, rowCache } from "./helpers.ts";

export type ReleaseRow = Row<"Releases">;

export type VersionRow = Row<"Versions">;

/** One stem of a version, as TrackMeta stores it. */
export interface StoredTrack {
  id: string;
  path: string;
  name: string;
  mime: string;
}

/** An uploaded file on disk, its type as the client said. */
export interface UploadedAudio {
  file: string;
  mime: string;
  name?: string;
}

const releaseCache = rowCache<ReleaseRow | null>();

export async function getReleaseRecord(
  uid: string,
): Promise<ReleaseRow | null> {
  const hit = releaseCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Releases", { Uid: [uid] });
  const rec = recs[0] || null;
  releaseCache.set(uid, { rec, exp: Date.now() + ROW_TTL_MS });
  return rec;
}

export function invalidateRelease(uid: string): void {
  releaseCache.delete(uid);
}

export function publicRelease(rec: ReleaseRow) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    title: f.Title || "",
    artist: f.Artist || "",
    releaseDate: f.ReleaseDate || null,
    description: f.Description || "",
    canDownload: Boolean(f.CanDownload),
    songUuid: f.SongUuid || null,
    createdAt: f.CreatedAt || "",
  };
}

// TrackMeta is a JSON array of { id, path, name, mime }, one per stem, in order.
export function tracksOf(rec: {
  fields: { TrackMeta: string };
}): StoredTrack[] {
  try {
    const parsed = JSON.parse(rec.fields.TrackMeta || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapVersion(rec: VersionRow): ReleaseVersion {
  const f = rec.fields;
  return {
    id: f.Uid,
    name: f.Name || "Version",
    isDefault: Boolean(f.IsDefault),
    hidden: Boolean(f.Hidden),
    audioMime: f.AudioMime || null,
    tracks: tracksOf(rec).map((t) => ({
      id: t.id,
      name: t.name,
      mime: t.mime,
    })),
    createdAt: f.CreatedAt || "",
  };
}

const versionsCache = rowCache<VersionRow[]>();

export async function getVersionRecords(
  releaseUid: string,
): Promise<VersionRow[]> {
  const hit = versionsCache.get(releaseUid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Versions", {
    ReleaseUid: [releaseUid],
  });
  versionsCache.set(releaseUid, { rec: recs, exp: Date.now() + ROW_TTL_MS });
  return recs;
}

export function invalidateVersions(releaseUid: string): void {
  versionsCache.delete(releaseUid);
}

/** One version of a release by its uid, or undefined. */
export async function versionOf(
  releaseUid: string,
  versionUid: string,
): Promise<VersionRow | undefined> {
  const versions = await getVersionRecords(releaseUid);
  return versions.find((v) => v.fields.Uid === versionUid);
}

export function versionCachePath(uid: string): string {
  return path.join(CACHE_DIR, `version-${uid}`);
}

/** The extension a version's mixdown is FILED under; a type that names none is not audio to the zone, so mp3. */
export function versionExt(mime: string): string {
  return audioExtOf(mime) ?? "mp3";
}

// Per-stem cache key: the stem's rank in the version, plus an ext the browser can sniff.
export function versionTrackCachePath(
  versionUid: string,
  entry: { id: string; mime: string },
): string {
  return path.join(
    CACHE_DIR,
    `version-${versionUid}-${entry.id}.${audioExtOf(entry.mime) ?? "bin"}`,
  );
}
