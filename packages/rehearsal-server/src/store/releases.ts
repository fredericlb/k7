// releases.ts — a release: a finished song with one or more versions, owned by who published it.
// Its versions are versions.ts; the rows both read are releaseRows.ts (../../docs/audio.md).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { sidecarFor } from "@studio/mediatek/song";
import { K7_ARTIST } from "@studio/mediatek/types";
import * as db from "../db.ts";
import * as mediatek from "../mediatek.ts";
import type { FieldsOf } from "../schema.ts";
import { dirOf, safeRemote, safeUnlink } from "./helpers.ts";
import {
  getReleaseRecord,
  getVersionRecords,
  invalidateRelease,
  invalidateVersions,
  mapVersion,
  publicRelease,
  tracksOf,
  type UploadedAudio,
  versionExt,
  versionOf,
  versionTrackCachePath,
} from "./releaseRows.ts";
import {
  addVersion,
  dropVersionCache,
  forgetVersionFolder,
  seedVersionCache,
} from "./versions.ts";

export async function getReleaseOwner(uid: string): Promise<string | null> {
  const rec = await getReleaseRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function listReleases(ownerId: string) {
  const recs = await db.listRecords("Releases", { OwnerId: [ownerId] });
  return recs
    .map(publicRelease)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getRelease(uid: string) {
  const rec = await getReleaseRecord(uid);
  if (!rec) return null;
  const versions = (await getVersionRecords(uid))
    .map(mapVersion)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const def = versions.find((v) => v.isDefault) || versions[0] || null;
  return {
    ...publicRelease(rec),
    versions,
    defaultVersionId: def ? def.id : null,
  };
}

/** What a new release is made with; the route has checked title and artist. */
interface NewRelease {
  title: string;
  artist: string;
  releaseDate?: string | null;
  description?: string;
  canDownload?: boolean;
  songUuid?: string;
}

export async function createRelease(
  ownerId: string,
  fields: NewRelease,
  firstVersion: {
    name: string;
    mixdown: UploadedAudio;
    tracks?: UploadedAudio[];
  },
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Releases", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Title: fields.title,
      Artist: fields.artist,
      ReleaseDate: fields.releaseDate || "",
      Description: fields.description || "",
      CanDownload: Boolean(fields.canDownload),
      SongUuid: fields.songUuid || "",
      CreatedAt: createdAt,
    },
  ]);
  invalidateRelease(uid);
  await addVersion(
    uid,
    { name: firstVersion.name, isDefault: true },
    firstVersion.mixdown,
    firstVersion.tracks || [],
  );
  return getRelease(uid);
}

/** Edit a release's own fields; a new title is also the album in every version's sidecar. */
export async function updateRelease(
  uid: string,
  patch: Partial<Omit<NewRelease, "songUuid">>,
) {
  const rec = await getReleaseRecord(uid);
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Releases">> = {};
  if (patch.title !== undefined) fields.Title = patch.title;
  if (patch.artist !== undefined) fields.Artist = patch.artist;
  if (patch.releaseDate !== undefined)
    fields.ReleaseDate = patch.releaseDate || "";
  if (patch.description !== undefined) fields.Description = patch.description;
  if (patch.canDownload !== undefined)
    fields.CanDownload = Boolean(patch.canDownload);
  await db.patchRecord("Releases", rec.id, fields);
  invalidateRelease(uid);
  const title = patch.title;
  if (title !== undefined && title !== rec.fields.Title) {
    // Folders keep their names and only the sidecars are rewritten — ../../docs/audio.md.
    for (const v of await getVersionRecords(uid)) {
      if (!v.fields.AudioPath) continue;
      await mediatek
        .putFile(
          `${dirOf(v.fields.AudioPath)}/song.yaml`,
          sidecarFor({
            title: String(v.fields.Name || "Version"),
            artist: K7_ARTIST,
            album: title,
            source: "k7",
          }),
        )
        .catch(() => {
          // A stale album in the library is worth less than an edit that fails.
        });
    }
  }
  return getRelease(uid);
}

// The release for a k7 song id, owner-scoped so two users' ids cannot collide.
export async function getReleaseBySongUuid(ownerId: string, songUuid: string) {
  if (!songUuid) return null;
  const recs = await db.listRecords("Releases", {
    SongUuid: [songUuid],
    OwnerId: [ownerId],
  });
  return recs[0] ? publicRelease(recs[0]) : null;
}

export async function deleteRelease(uid: string): Promise<boolean> {
  const rec = await getReleaseRecord(uid);
  if (!rec) return false;
  const versions = await getVersionRecords(uid);
  for (const v of versions) await forgetVersionFolder(v);
  db.inTransaction(() => {
    db.deleteRecords(
      "Versions",
      versions.map((v) => v.id),
    );
    db.deleteRecords("Releases", [rec.id]);
  });
  for (const v of versions) {
    dropVersionCache(v.fields.Uid, String(v.fields.AudioPath ?? ""));
    for (const t of tracksOf(v))
      safeUnlink(versionTrackCachePath(v.fields.Uid, t));
  }
  invalidateRelease(uid);
  invalidateVersions(uid);
  return true;
}

/** Swap a version's mixdown for another file, keeping its name, its stems and its place. */
export async function replaceVersionAudio(
  releaseUid: string,
  versionUid: string,
  mixdown: UploadedAudio,
) {
  const rec = await versionOf(releaseUid, versionUid);
  if (!rec) return null;
  const release = await getReleaseRecord(releaseUid);
  const previous = String(rec.fields.AudioPath || "");

  // The same tagged album and title, so the bytes land in the folder this version owns; a legacy one moves there.
  const master = await mediatek.pushVersion(
    await fs.openAsBlob(mixdown.file),
    versionExt(mixdown.mime),
    {
      album: release?.fields.Title || "",
      title: String(rec.fields.Name || "Version"),
      releaseUid,
      versionUid,
    },
  );
  await db.patchRecord("Versions", rec.id, {
    AudioPath: master,
    AudioMime: mixdown.mime,
    // Another file has another shape; the next reader measures this one.
    Envelope: "",
  });
  // Another container leaves the old master beside the new one, and the scan takes the FIRST.
  if (previous && previous !== master) await safeRemote(previous);

  seedVersionCache(mixdown, master, versionUid);
  invalidateVersions(releaseUid);
  return getRelease(releaseUid);
}
