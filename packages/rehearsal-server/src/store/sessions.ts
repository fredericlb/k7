// sessions.ts — a session row, its recording and its envelope, and the markers pinned on it.
// A recording's BYTES live in the médiathèque, the row keeping its path; cached on disk for Range (../../docs/audio.md).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ffmpegBin } from "@studio/ffmpeg";
import type { Annotation, Envelope, Marker } from "@studio/rehearsal-shared";
import { cachedFile, once } from "../cache.ts";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import { concatArgs, runTool } from "../ffmpeg.ts";
import { serialized } from "../lock.ts";
import * as mediatek from "../mediatek.ts";
import type { FieldsOf } from "../schema.ts";
import { audioExtOf, audioMimeOf } from "../serve.ts";
import {
  CACHE_DIR,
  fetching,
  mapComment,
  mapMarker,
  ROW_TTL_MS,
  rowCache,
  rowIn,
  safeUnlink,
} from "./helpers.ts";

type SessionRow = Row<"Sessions">;

const sessionCache = rowCache<SessionRow | null>();

export async function getSessionRecord(
  uid: string,
): Promise<SessionRow | null> {
  const hit = sessionCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Sessions", { Uid: [uid] });
  const rec = recs[0] || null;
  sessionCache.set(uid, { rec, exp: Date.now() + ROW_TTL_MS });
  return rec;
}

function invalidate(uid: string): void {
  sessionCache.delete(uid);
}

function publicSession(rec: SessionRow) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    createdAt: f.CreatedAt,
    duration: f.Duration || 0,
    // The PATH says there is audio, not the flag beside it — see ../../docs/audio.md.
    hasRecording: Boolean(f.RecordingPath),
    recordingMime: f.RecordingMime || null,
    gain: f.Gain || 1, // playback normalization gain (max before clipping)
    annotations: [] as Annotation[],
    markers: [] as Marker[],
  };
}

/** Raw session row, for ownership checks (cheap, cached). */
export async function getOwner(uid: string): Promise<string | null> {
  const rec = await getSessionRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

// What a session CARD shows — never the envelope, which runs past 100 KB a session.
const SESSION_LIST_FIELDS = [
  "Uid",
  "OwnerId",
  "CreatedAt",
  "Duration",
  "RecordingPath",
  "RecordingMime",
  "Gain",
];

/** Group rows by the session they belong to. */
function bySession<T extends { fields: { SessionUid: string } }>(
  rows: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.fields.SessionUid;
    const list = out.get(key);
    if (list) list.push(r);
    else out.set(key, [r]);
  }
  return out;
}

export async function listSessions(ownerId: string) {
  const recs = await db.listRecords(
    "Sessions",
    { OwnerId: [ownerId] },
    { fields: SESSION_LIST_FIELDS },
  );
  const uids = recs.map((r) => r.fields.Uid);
  const comments = uids.length
    ? await db.listRecords("Comments", { SessionUid: uids })
    : [];
  const markers = uids.length
    ? await db.listRecords("Markers", { SessionUid: uids })
    : [];
  const byUid = bySession(comments);
  const markersByUid = bySession(markers);
  return recs
    .map((r) => {
      const s = publicSession(r);
      s.annotations = (byUid.get(s.id) || [])
        .map(mapComment)
        .sort((a, b) => a.startSec - b.startSec);
      s.markers = (markersByUid.get(s.id) || [])
        .map(mapMarker)
        .sort((a, b) => a.atSec - b.atSec);
      return s;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getSession(uid: string) {
  const rec = await getSessionRecord(uid);
  if (!rec) return null;
  const s = publicSession(rec);
  const comments = await db.listRecords("Comments", { SessionUid: [uid] });
  s.annotations = comments
    .map(mapComment)
    .sort((a, b) => a.startSec - b.startSec);
  const markers = await db.listRecords("Markers", { SessionUid: [uid] });
  s.markers = markers.map(mapMarker).sort((a, b) => a.atSec - b.atSec);
  return s;
}

export async function createSession(ownerId: string) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Sessions", [
    {
      Uid: uid,
      OwnerId: ownerId,
      CreatedAt: createdAt,
      Duration: 0,
      HasRecording: false,
    },
  ]);
  invalidate(uid);
  return {
    id: uid,
    ownerId,
    createdAt,
    duration: 0,
    hasRecording: false,
    recordingMime: null,
    annotations: [],
    markers: [],
  };
}

export async function deleteSession(uid: string): Promise<boolean> {
  const rec = await getSessionRecord(uid);
  // The bytes go BEFORE the row that holds their path — see ../../docs/audio.md.
  if (rec?.fields.RecordingPath)
    await mediatek.remove(rec.fields.RecordingPath).catch(() => {
      // A library that is down must not block a deletion; the orphan stays visible.
    });
  // Moments (Comments) survive on their own clips; markers are the session's and go with it.
  db.inTransaction(() => {
    db.deleteRecords(
      "Markers",
      db
        .listRecords("Markers", { SessionUid: [uid] }, { fields: [] })
        .map((r) => r.id),
    );
    if (rec) db.deleteRecords("Sessions", [rec.id]);
  });
  invalidate(uid);
  safeUnlink(cachePathFor(rec));
  return Boolean(rec);
}

// --- Recording + envelope ---------------------------------------------------

/** A session's bytes into the médiathèque, answering where they went — ../../docs/audio.md. */
async function storeBytes(
  rec: SessionRow,
  buffer: Blob,
  ext: string,
): Promise<string> {
  const previous = rec.fields.RecordingPath || "";
  if (previous.endsWith(`.${mediatek.zoneExt(ext)}`)) {
    await mediatek.putFile(previous, buffer);
    return previous;
  }
  // The session's own moment, not now: a take saved after midnight belongs to that evening.
  const at = rec.fields.CreatedAt ? new Date(rec.fields.CreatedAt) : undefined;
  const next = await mediatek.push(
    buffer,
    ext,
    at && !Number.isNaN(at.getTime()) ? at : undefined,
  );
  if (previous) await mediatek.remove(previous);
  return next;
}

async function saveRecordingUnlocked(
  uid: string,
  file: string,
  mime: string,
  ext: string,
  duration: number,
  envelope: Envelope,
  gain: number,
) {
  const rec = await getSessionRecord(uid);
  if (!rec) return null;

  // A file-backed Blob: fetch streams it from disk, and the take is never whole in memory (../../docs/audit.md).
  const recordingPath = await storeBytes(rec, await fs.openAsBlob(file), ext);
  await db.patchRecord("Sessions", rec.id, {
    RecordingPath: recordingPath,
    HasRecording: true,
    RecordingMime: mime,
    Duration: duration,
    Gain: gain || 1,
    Envelope: JSON.stringify({
      intervalMs: envelope.intervalMs,
      samples: envelope.samples,
    }),
  });

  // Prime the disk cache so the first playback streams straight away — by MOVING the upload, not copying it.
  fs.renameSync(file, path.join(CACHE_DIR, `${uid}.${ext}`));
  invalidate(uid);
  return getSession(uid);
}

// Continue a saved session: the new take is glued onto the old one, so it grows in place.
async function appendRecordingUnlocked(
  uid: string,
  file: string,
  mime: string,
  ext: string,
  duration: number,
  envelope: Envelope,
  gain: number,
) {
  const rec = await getSessionRecord(uid);
  if (!rec) return null;
  // Nothing to append TO: the path decides, not the flag beside it.
  if (!rec.fields.RecordingPath)
    return saveRecordingUnlocked(
      uid,
      file,
      mime,
      ext,
      duration,
      envelope,
      gain,
    );

  const existing = await ensureRecordingCached(uid);
  if (!existing)
    return saveRecordingUnlocked(
      uid,
      file,
      mime,
      ext,
      duration,
      envelope,
      gain,
    );

  // WebM/Opus can't be byte-concatenated — re-mux the two takes into one file, on disk from end to end.
  let combined: string;
  try {
    combined = await concatRecordings([existing.filePath, file]);
  } finally {
    safeUnlink(file);
  }

  // The new samples follow the existing timeline, at their own scale — ../../docs/audio.md.
  const prev = (await getEnvelope(uid)) || {
    intervalMs: envelope.intervalMs,
    samples: [],
  };
  const combinedSamples = [
    ...(prev.samples || []),
    ...(envelope.samples || []),
  ];
  const prevDuration = Number(rec.fields.Duration) || 0;
  const prevGain = Number(rec.fields.Gain) || 1;
  // gain is 0.9 / truePeak, so the smaller of the two clears the louder peak.
  const combinedGain = Math.min(prevGain, gain || 1);
  const combinedMime = "audio/webm";

  let recordingPath: string;
  try {
    recordingPath = await storeBytes(
      rec,
      await fs.openAsBlob(combined),
      "webm",
    );
  } catch (err) {
    safeUnlink(combined);
    throw err;
  }
  const oldCache = cachePathFor(rec);
  await db.patchRecord("Sessions", rec.id, {
    RecordingPath: recordingPath,
    HasRecording: true,
    RecordingMime: combinedMime,
    Duration: prevDuration + duration,
    Gain: combinedGain,
    Envelope: JSON.stringify({
      intervalMs: prev.intervalMs || envelope.intervalMs,
      samples: combinedSamples,
    }),
  });

  // The combined file is always webm, so drop any stale differently-typed cache file.
  const newCache = path.join(CACHE_DIR, `${uid}.webm`);
  if (oldCache && oldCache !== newCache) safeUnlink(oldCache);
  fs.renameSync(combined, newCache);
  invalidate(uid);
  return getSession(uid);
}

/** The recording on disk for Range streaming; no path means no audio (../../docs/audio.md). */
export async function ensureRecordingCached(
  uid: string,
): Promise<{ filePath: string; mime: string } | null> {
  const rec = await getSessionRecord(uid);
  if (!rec?.fields.RecordingPath) return null;
  const remote = rec.fields.RecordingPath;
  const filePath = path.join(
    CACHE_DIR,
    `${uid}.${extFor(rec.fields.RecordingMime || "audio/webm")}`,
  );
  if (!cachedFile(filePath))
    await once(fetching, filePath, () =>
      mediatek.download(String(remote), filePath),
    );
  return { filePath, mime: audioMimeOf(filePath) };
}

export async function getEnvelope(uid: string): Promise<Envelope | null> {
  const rec = await getSessionRecord(uid);
  if (!rec?.fields.Envelope) return null;
  try {
    return JSON.parse(rec.fields.Envelope) as Envelope;
  } catch {
    return null;
  }
}

/** A session's cache file extension, the same the upload filed it under. */
function extFor(mime: string): string {
  return audioExtOf(mime) ?? "webm";
}

function cachePathFor(rec: SessionRow | null): string | null {
  if (!rec) return null;
  return path.join(
    CACHE_DIR,
    `${rec.fields.Uid}.${extFor(rec.fields.RecordingMime || "")}`,
  );
}

// A re-encode of hours of audio is minutes of CPU at most: past this, the child is stuck and is killed.
const CONCAT_TIMEOUT_MS = 30 * 60_000;

// Several audio files into one webm/opus FILE, through ffmpeg's concat filter; the caller owns the path it resolves.
async function concatRecordings(paths: string[]): Promise<string> {
  const outPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.webm`);
  try {
    await runTool(ffmpegBin(), concatArgs(paths, outPath), {
      timeoutMs: CONCAT_TIMEOUT_MS,
      what: "ffmpeg concat",
    });
  } catch (e) {
    safeUnlink(outPath);
    throw e;
  }
  return outPath;
}

// --- Markers (single-timestamp pins with an optional comment) ----------------

export async function addMarker(
  uid: string,
  { atSec, comment }: { atSec?: number; comment?: string },
  ownerId?: string,
): Promise<Marker> {
  const marker = {
    atSec: Number(atSec) || 0,
    comment: String(comment ?? ""),
    createdAt: new Date().toISOString(),
  };
  const owner = ownerId || (await getOwner(uid));
  const [{ id }] = await db.addRecords("Markers", [
    {
      SessionUid: uid,
      OwnerId: owner ?? "",
      AtSec: marker.atSec,
      Comment: marker.comment,
      CreatedAt: marker.createdAt,
    },
  ]);
  return { id: String(id), ...marker };
}

export async function updateMarker(
  uid: string,
  markerId: string,
  patch: { atSec?: number; comment?: string },
): Promise<Marker | null> {
  // Found in THIS session before anything is written, or a row id would edit anyone's marker.
  const rec = rowIn("Markers", markerId, { SessionUid: uid });
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Markers">> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await db.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export async function deleteMarker(
  uid: string,
  markerId: string,
): Promise<boolean> {
  const rec = rowIn("Markers", markerId, { SessionUid: uid });
  if (!rec) return false;
  await db.deleteRecords("Markers", [rec.id]);
  return true;
}

// One at a time per session — a read-modify-write here has no transaction to lean on (../lock.ts).

export function saveRecording(
  ...args: Parameters<typeof saveRecordingUnlocked>
) {
  return serialized(`session:${args[0]}`, () => saveRecordingUnlocked(...args));
}

export function appendRecording(
  ...args: Parameters<typeof appendRecordingUnlocked>
) {
  return serialized(`session:${args[0]}`, () =>
    appendRecordingUnlocked(...args),
  );
}
