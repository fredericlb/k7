// Data access for sessions, highlights and comments — backed by PocketBase.
//
// - Session metadata, the loudness envelope (JSON), highlights and comments
//   live in PocketBase collections (see migrate.ts for the schema).
// - The recording's BYTES live in the médiathèque's RECORDINGS zone; PocketBase
//   keeps only the path to them. Cached on local disk so it can be streamed with
//   HTTP Range for fast seeking. See docs/audio.md.
// - A short in-memory cache of session rows keeps range requests / ownership
//   checks from hitting PocketBase on every call.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Annotation,
  Envelope,
  Marker,
  Release,
  SongEnvelope,
} from "@k7/shared";
import { sheetExt } from "@k7/shared/sheetKind";
import { segment, sidecarFor } from "@studio/mediatek/song";
import * as mediatek from "./mediatek.ts";
import * as db from "./pocketbase.ts";
import { envelopeOf } from "./songEnvelope.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "data", "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// TODO This file should be split in a store/ folder to separate each related entity

// --- session-row cache (uid -> { rec, exp }) --------------------------------

const SESSION_TTL_MS = 15_000;
const sessionCache = new Map();

async function getSessionRecord(uid) {
  const hit = sessionCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Sessions", { Uid: [uid] });
  const rec = recs[0] || null;
  sessionCache.set(uid, { rec, exp: Date.now() + SESSION_TTL_MS });
  return rec;
}

function invalidate(uid) {
  sessionCache.delete(uid);
}

const releaseCache = new Map();

async function getReleaseRecord(uid) {
  const hit = releaseCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Releases", { Uid: [uid] });
  const rec = recs[0] || null;
  releaseCache.set(uid, { rec, exp: Date.now() + SESSION_TTL_MS });
  return rec;
}

function invalidateRelease(uid) {
  releaseCache.delete(uid);
}

// --- mapping ----------------------------------------------------------------

function publicSession(rec) {
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

function mapMarker(rec) {
  const f = rec.fields;
  return {
    id: String(rec.id),
    atSec: Number(f.AtSec) || 0,
    comment: f.Comment || "",
    createdAt: f.CreatedAt || "",
  };
}

function mapComment(rec) {
  const f = rec.fields;
  return {
    id: String(rec.id),
    sessionUid: f.SessionUid || null,
    startSec: Number(f.StartSec),
    endSec: Number(f.EndSec),
    text: f.Text || "",
    tags: parseTags(f.Tags),
    validated: Boolean(f.Validated),
    createdAt: f.CreatedAt || "",
  };
}

// --- ownership helper -------------------------------------------------------

/** Raw session row, for ownership checks (cheap, cached). */
export async function getOwner(uid) {
  const rec = await getSessionRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

// --- Sessions ---------------------------------------------------------------

export async function listSessions(ownerId) {
  const recs = await db.listRecords("Sessions", { OwnerId: [ownerId] });
  const uids = recs.map((r) => r.fields.Uid);
  const comments = uids.length
    ? await db.listRecords("Comments", { SessionUid: uids })
    : [];
  const markers = uids.length
    ? await db.listRecords("Markers", { SessionUid: uids })
    : [];
  const byUid = new Map();
  for (const c of comments) {
    const key = c.fields.SessionUid;
    if (!byUid.has(key)) byUid.set(key, []);
    byUid.get(key).push(c);
  }
  const markersByUid = new Map();
  for (const m of markers) {
    const key = m.fields.SessionUid;
    if (!markersByUid.has(key)) markersByUid.set(key, []);
    markersByUid.get(key).push(m);
  }
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

export async function getSession(uid) {
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

export async function createSession(ownerId) {
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

export async function deleteSession(uid) {
  const rec = await getSessionRecord(uid);
  const highlights = await db.listRecords("Highlights", {
    SessionUid: [uid],
  });
  await db.deleteRecords(
    "Highlights",
    highlights.map((h) => h.id),
  );
  // Markers are session-scoped (unlike moments) — remove them with the session.
  const markers = await db.listRecords("Markers", { SessionUid: [uid] });
  await db.deleteRecords(
    "Markers",
    markers.map((m) => m.id),
  );
  // Moments (Comments) survive on their own clips; they only lose the link back here.

  // The bytes go BEFORE the row that holds their path — see ../../docs/audio.md.
  if (rec?.fields.RecordingPath)
    await mediatek.remove(rec.fields.RecordingPath).catch(() => {
      // A library that is down must not block a deletion; the orphan stays visible.
    });
  if (rec) await db.deleteRecords("Sessions", [rec.id]);
  invalidate(uid);
  safeUnlink(cachePathFor(rec));
  return Boolean(rec);
}

// --- Recording + envelope ---------------------------------------------------

/** A session's bytes into the médiathèque, answering where they went — ../../docs/audio.md. */
async function storeBytes(rec, buffer, ext) {
  const previous = rec.fields.RecordingPath || "";
  if (previous.endsWith(`.${mediatek.zoneExt(ext)}`)) {
    await mediatek.replace(previous, buffer);
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

export async function saveRecording(
  uid,
  buffer,
  mime,
  ext,
  duration,
  envelope,
  gain,
) {
  const rec = await getSessionRecord(uid);
  if (!rec) return null;

  const recordingPath = await storeBytes(rec, buffer, ext);
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

  // Prime the disk cache so the first playback streams straight away.
  fs.writeFileSync(path.join(CACHE_DIR, `${uid}.${ext}`), buffer);
  invalidate(uid);
  return getSession(uid);
}

// Continue a saved session: the new take is glued onto the old one, so it grows in place.
export async function appendRecording(
  uid,
  buffer,
  mime,
  ext,
  duration,
  envelope,
  gain,
) {
  const rec = await getSessionRecord(uid);
  if (!rec) return null;
  // Nothing to append TO: the path decides, not the flag beside it.
  if (!rec.fields.RecordingPath)
    return saveRecording(uid, buffer, mime, ext, duration, envelope, gain);

  const existing = await ensureRecordingCached(uid);
  if (!existing)
    return saveRecording(uid, buffer, mime, ext, duration, envelope, gain);

  // WebM/Opus can't be byte-concatenated — re-mux the two takes into one file.
  const newPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.${ext}`);
  fs.writeFileSync(newPath, buffer);
  let combined;
  try {
    combined = await concatRecordings([existing.filePath, newPath]);
  } finally {
    safeUnlink(newPath);
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

  const recordingPath = await storeBytes(rec, combined, "webm");
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
  fs.writeFileSync(newCache, combined);
  invalidate(uid);
  return getSession(uid);
}

/** The recording on disk for Range streaming; no path means no audio (../../docs/audio.md). */
export async function ensureRecordingCached(uid) {
  const rec = await getSessionRecord(uid);
  if (!rec?.fields.RecordingPath) return null;
  const mime = rec.fields.RecordingMime || "audio/webm";
  const filePath = path.join(CACHE_DIR, `${uid}.${extFor(mime)}`);
  if (!fs.existsSync(filePath))
    await mediatek.download(String(rec.fields.RecordingPath), filePath);
  return { filePath, mime };
}

export async function getEnvelope(uid) {
  const rec = await getSessionRecord(uid);
  if (!rec || !rec.fields.Envelope) return null;
  try {
    return JSON.parse(rec.fields.Envelope);
  } catch {
    return null;
  }
}

// --- Highlights -------------------------------------------------------------

export async function replaceHighlights(uid, events) {
  const existing = await db.listRecords("Highlights", { SessionUid: [uid] });
  await db.deleteRecords(
    "Highlights",
    existing.map((h) => h.id),
  );
  if (events.length) {
    await db.addRecords(
      "Highlights",
      events.map((e) => ({
        SessionUid: uid,
        StartSec: e.startSec,
        EndSec: e.endSec,
        DurationSec: e.durationSec,
        Avg: e.avg,
        Peak: e.peak,
      })),
    );
  }
}

// --- Comments (annotations) -------------------------------------------------

export async function addAnnotation(
  uid,
  { startSec, endSec, text, tags },
  ownerId,
) {
  const ann = {
    startSec: Number(startSec),
    endSec: Number(endSec),
    text: String(text ?? ""),
    tags: normalizeTags(tags),
    createdAt: new Date().toISOString(),
  };
  // OwnerId sits on the moment itself so it stays addressable after its session goes.
  const owner = ownerId || (await getOwner(uid));
  const [{ id }] = await db.addRecords("Comments", [
    {
      SessionUid: uid,
      OwnerId: owner,
      StartSec: ann.startSec,
      EndSec: ann.endSec,
      Text: ann.text,
      Tags: ann.tags.join(","),
      CreatedAt: ann.createdAt,
    },
  ]);
  // Extract now so a saved moment plays on its own; best-effort, a failure leaves it be.
  const validated = await extractMomentClip(uid, {
    id,
    fields: { StartSec: ann.startSec, EndSec: ann.endSec },
  }).catch((e) => {
    console.error("moment auto-extract failed:", e.message);
    return false;
  });
  return { id: String(id), ...ann, validated };
}

export async function updateAnnotation(uid, annId, patch) {
  const before = (await db.listRecords("Comments", { SessionUid: [uid] })).find(
    (r) => r.id === annId,
  );
  if (!before) return null;

  const fields: Record<string, unknown> = {};
  if (patch.startSec !== undefined) fields.StartSec = Number(patch.startSec);
  if (patch.endSec !== undefined) fields.EndSec = Number(patch.endSec);
  if (patch.text !== undefined) fields.Text = String(patch.text);
  if (patch.tags !== undefined)
    fields.Tags = normalizeTags(patch.tags).join(",");
  await db.patchRecord("Comments", annId, fields);

  // A moved timespan makes the extracted clip wrong — drop it and re-extract.
  const rangeChanged =
    (fields.StartSec !== undefined &&
      fields.StartSec !== Number(before.fields.StartSec)) ||
    (fields.EndSec !== undefined &&
      fields.EndSec !== Number(before.fields.EndSec));
  if (rangeChanged) {
    safeUnlink(clipCachePath(annId));
    await extractMomentClip(uid, {
      id: annId,
      fields: { ...before.fields, ...fields },
    }).catch((e) => console.error("moment auto re-extract failed:", e.message));
  }

  const recs = await db.listRecords("Comments", { SessionUid: [uid] });
  const rec = recs.find((r) => r.id === annId);
  return rec ? mapComment(rec) : null;
}

export async function deleteAnnotation(uid, annId) {
  const recs = await db.listRecords("Comments", { SessionUid: [uid] });
  // Only a moment of THIS session: the row id alone would reach anyone's — ../../docs/ownership.md.
  const rec = recs.find((r) => r.id === annId);
  if (!rec) return false;
  await forgetClip(rec);
  await db.deleteRecords("Comments", [rec.id]);
  safeUnlink(clipCachePath(rec.id));
  return true;
}

// --- Markers (single-timestamp pins with an optional comment) ----------------

export async function addMarker(uid, { atSec, comment }, ownerId) {
  const marker = {
    atSec: Number(atSec) || 0,
    comment: String(comment ?? ""),
    createdAt: new Date().toISOString(),
  };
  const owner = ownerId || (await getOwner(uid));
  const [{ id }] = await db.addRecords("Markers", [
    {
      SessionUid: uid,
      OwnerId: owner,
      AtSec: marker.atSec,
      Comment: marker.comment,
      CreatedAt: marker.createdAt,
    },
  ]);
  return { id: String(id), ...marker };
}

export async function updateMarker(uid, markerId, patch) {
  // Found in THIS session before anything is written, or a row id would edit anyone's marker.
  const recs = await db.listRecords("Markers", { SessionUid: [uid] });
  const rec = recs.find((r) => r.id === markerId);
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await db.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export async function deleteMarker(uid, markerId) {
  const recs = await db.listRecords("Markers", { SessionUid: [uid] });
  const rec = recs.find((r) => r.id === markerId);
  if (!rec) return false;
  await db.deleteRecords("Markers", [rec.id]);
  return true;
}

// --- Standalone moments -----------------------------------------------------

// A moment has its own owner-addressable view, independent of the session it came from.
function publicMoment(rec, createdAtByUid) {
  const uid = rec.fields.SessionUid;
  return {
    ...mapComment(rec),
    // Sessions have no name, so the client labels a moment with its session's date.
    sessionCreatedAt: createdAtByUid.get(uid) ?? null,
    sessionAvailable: createdAtByUid.has(uid),
  };
}

async function ownerSessionCreatedAt(ownerId) {
  const sessions = await db.listRecords("Sessions", { OwnerId: [ownerId] });
  return new Map(sessions.map((s) => [s.fields.Uid, s.fields.CreatedAt || ""]));
}

export async function listMoments(ownerId) {
  const recs = await db.listRecords("Comments", { OwnerId: [ownerId] });
  const createdAtByUid = await ownerSessionCreatedAt(ownerId);
  return recs
    .map((r) => publicMoment(r, createdAtByUid))
    .sort(
      (a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        a.startSec - b.startSec,
    );
}

/** A moment by its own id, owner-scoped, with the envelope and markers its player needs. */
export async function getMoment(ownerId, momentId) {
  const recs = await db.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === momentId);
  if (!rec) return null;
  const createdAtByUid = await ownerSessionCreatedAt(ownerId);
  const base = publicMoment(rec, createdAtByUid);

  // The stored slice, or one cut live from the session when the moment carries none.
  let envelope: Envelope | null = null;
  if (rec.fields.Envelope) {
    try {
      envelope = JSON.parse(String(rec.fields.Envelope));
    } catch {
      envelope = null;
    }
  }
  if (!envelope && base.sessionAvailable && rec.fields.SessionUid) {
    const sessionEnv = await getEnvelope(rec.fields.SessionUid);
    if (sessionEnv)
      envelope = sliceEnvelope(sessionEnv, base.startSec, base.endSec);
  }

  const markers = await listMomentMarkers(ownerId, momentId);
  return { ...base, envelope, markers };
}

export async function deleteMoment(ownerId, momentId) {
  const recs = await db.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === momentId);
  if (!rec) return false;
  await forgetClip(rec);
  await db.deleteRecords("Comments", [rec.id]);
  safeUnlink(clipCachePath(rec.id));
  return true;
}

/** A moment's clip out of the zone, before the row that holds its path; never fatal. */
async function forgetClip(rec) {
  if (!rec?.fields.ClipPath) return;
  await mediatek.remove(rec.fields.ClipPath).catch(() => {});
}

/** Ensure a moment's clip is cached, looked up by owner + moment id alone. */
export async function ensureMomentClipCached(ownerId, momentId) {
  // The owner is checked BEFORE the cache: a cached file must not answer for someone else's moment.
  const recs = await db.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === momentId);
  if (!rec?.fields.ClipPath) return null;
  const filePath = clipCachePath(rec.id);
  if (fs.existsSync(filePath)) return { filePath, mime: "audio/webm" };
  await mediatek.download(String(rec.fields.ClipPath), filePath);
  return { filePath, mime: "audio/webm" };
}

// --- Moment markers ---------------------------------------------------------

// Pins on a moment's clip timeline: the shared Markers table, keyed by MomentId not SessionUid.
export async function listMomentMarkers(ownerId, momentId) {
  const recs = await db.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  return recs
    .filter((r) => r.fields.OwnerId === ownerId)
    .map(mapMarker)
    .sort((a, b) => a.atSec - b.atSec);
}

export async function addMomentMarker(ownerId, momentId, { atSec, comment }) {
  const marker = {
    atSec: Number(atSec) || 0,
    comment: String(comment ?? ""),
    createdAt: new Date().toISOString(),
  };
  const [{ id }] = await db.addRecords("Markers", [
    {
      MomentId: String(momentId),
      OwnerId: ownerId,
      AtSec: marker.atSec,
      Comment: marker.comment,
      CreatedAt: marker.createdAt,
    },
  ]);
  return { id: String(id), ...marker };
}

export async function updateMomentMarker(ownerId, momentId, markerId, patch) {
  const recs = await db.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  const rec = recs.find(
    (r) => r.id === markerId && r.fields.OwnerId === ownerId,
  );
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await db.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export async function deleteMomentMarker(ownerId, momentId, markerId) {
  const recs = await db.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  const rec = recs.find(
    (r) => r.id === markerId && r.fields.OwnerId === ownerId,
  );
  if (!rec) return false;
  await db.deleteRecords("Markers", [rec.id]);
  return true;
}

// --- Moment validation (extract a standalone clip) --------------------------

// A moment's timespan cut out of the session recording into its own clip — ../../docs/audio.md.
async function extractMomentClip(sessionUid, rec) {
  const info = await ensureRecordingCached(sessionUid);
  if (!info) return false;

  const start = Number(rec.fields.StartSec);
  const end = Number(rec.fields.EndSec);
  const clip = await extractClip(info.filePath, start, end);

  // The moment's own envelope, so its view still draws a waveform once the session is gone.
  const sessionEnv = await getEnvelope(sessionUid);
  const sliced = sessionEnv ? sliceEnvelope(sessionEnv, start, end) : null;

  // Re-extracting replaces: the span or the name may have moved, so the old name is a lie.
  const previous = rec.fields.ClipPath;
  const clipPath = await mediatek.pushMoment(clip, "webm", {
    at: momentPlayedAt(await getSessionRecord(sessionUid), start),
    durationSec: end - start,
    label: rec.fields.Text,
  });
  if (previous && previous !== clipPath) await mediatek.remove(previous);

  await db.patchRecord("Comments", rec.id, {
    Validated: true,
    ClipPath: clipPath,
    Envelope: sliced ? JSON.stringify(sliced) : "",
  });
  fs.writeFileSync(clipCachePath(rec.id), clip);
  return true;
}

/** When a moment was PLAYED: session start plus offset, not the annotation's CreatedAt. */
function momentPlayedAt(sessionRec, startSec) {
  const started = sessionRec?.fields.CreatedAt
    ? new Date(sessionRec.fields.CreatedAt)
    : null;
  if (!started || Number.isNaN(started.getTime())) return undefined;
  return new Date(started.getTime() + Math.max(0, startSec) * 1000);
}

// The session envelope over [startSec, endSec], re-based to a clip timeline starting at 0.
function sliceEnvelope(env, startSec, endSec) {
  const per = (env.intervalMs || 200) / 1000;
  const i0 = Math.max(0, Math.floor(startSec / per));
  const i1 = Math.min(env.samples.length, Math.ceil(endSec / per));
  return {
    intervalMs: env.intervalMs || 200,
    samples: env.samples.slice(i0, i1),
  };
}

// Manual re-extract, for a moment whose automatic one could not run.
export async function validateMoment(sessionUid, momentId) {
  const moments = await db.listRecords("Comments", {
    SessionUid: [sessionUid],
  });
  const rec = moments.find((m) => m.id === momentId);
  if (!rec) return null;
  const ok = await extractMomentClip(sessionUid, rec);
  if (!ok) throw new Error("session has no recording to clip");
  return mapComment({ id: rec.id, fields: { ...rec.fields, Validated: true } });
}

/** Ensure a validated moment's clip is on disk; returns { filePath, mime }. */
export async function ensureClipCached(sessionUid, momentId) {
  // The moment must be THIS session's before the cache answers: a cached file has no owner of its own.
  const moments = await db.listRecords("Comments", {
    SessionUid: [sessionUid],
  });
  const rec = moments.find((m) => m.id === momentId);
  if (!rec?.fields.ClipPath) return null;
  const filePath = clipCachePath(rec.id);
  if (fs.existsSync(filePath)) return { filePath, mime: "audio/webm" };
  await mediatek.download(String(rec.fields.ClipPath), filePath);
  return { filePath, mime: "audio/webm" };
}

function clipCachePath(momentId) {
  return path.join(CACHE_DIR, `clip-${momentId}.webm`);
}

// Several audio files into one webm/opus buffer, through ffmpeg's concat filter.
function concatRecordings(paths) {
  return new Promise<Buffer>((resolve, reject) => {
    const outPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.webm`);
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    for (const p of paths) args.push("-i", p);
    // The concat filter needs identical parameters, so each input is coerced to one format.
    const fmt =
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
    const pre = paths.map((_, i) => `[${i}:a]${fmt}[a${i}]`).join(";");
    const labels = paths.map((_, i) => `[a${i}]`).join("");
    args.push(
      "-filter_complex",
      `${pre};${labels}concat=n=${paths.length}:v=0:a=1[a]`,
      "-map",
      "[a]",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-f",
      "webm",
      outPath,
    );
    const ff = spawn("ffmpeg", args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) =>
      reject(
        new Error(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "ffmpeg is not installed (run: brew install ffmpeg)"
            : e.message,
        ),
      ),
    );
    ff.on("close", (code) => {
      if (code !== 0)
        return reject(new Error("ffmpeg concat failed: " + err.slice(-300)));
      try {
        const buf = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Cut [start, end] out of a source file into a webm/opus buffer using ffmpeg.
function extractClip(srcPath, start, end) {
  return new Promise<Buffer>((resolve, reject) => {
    const duration = Math.max(0.05, end - start);
    const outPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.webm`);
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(start),
      "-i",
      srcPath,
      "-t",
      String(duration),
      "-vn",
      // EBU R128 normalization, so a standalone clip sits at -14 LUFS, true peak -1 dBTP.
      "-af",
      "loudnorm=I=-14:TP=-1.0:LRA=11",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-f",
      "webm",
      outPath,
    ];
    const ff = spawn("ffmpeg", args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) =>
      reject(
        new Error(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "ffmpeg is not installed (run: brew install ffmpeg)"
            : e.message,
        ),
      ),
    );
    ff.on("close", (code) => {
      if (code !== 0)
        return reject(new Error("ffmpeg failed: " + err.slice(-300)));
      try {
        const buf = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// --- Releases (standalone songs, unrelated to sessions/moments) -------------

function publicRelease(rec) {
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
function tracksOf(rec) {
  try {
    const parsed = JSON.parse(rec.fields.TrackMeta || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapVersion(rec) {
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

export async function getReleaseOwner(uid) {
  const rec = await getReleaseRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function listReleases(ownerId) {
  const recs = await db.listRecords("Releases", { OwnerId: [ownerId] });
  return recs
    .map(publicRelease)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getRelease(uid) {
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

export async function createRelease(ownerId, fields, firstVersion) {
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
export async function updateRelease(uid, patch) {
  const rec = await getReleaseRecord(uid);
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) fields.Title = patch.title;
  if (patch.artist !== undefined) fields.Artist = patch.artist;
  if (patch.releaseDate !== undefined)
    fields.ReleaseDate = patch.releaseDate || "";
  if (patch.description !== undefined) fields.Description = patch.description;
  if (patch.canDownload !== undefined)
    fields.CanDownload = Boolean(patch.canDownload);
  await db.patchRecord("Releases", rec.id, fields);
  invalidateRelease(uid);
  if (patch.title !== undefined && patch.title !== rec.fields.Title) {
    // Folders keep their names and only the sidecars are rewritten — ../../docs/audio.md.
    for (const v of await getVersionRecords(uid)) {
      if (!v.fields.AudioPath) continue;
      await mediatek
        .putFile(
          `${dirOf(v.fields.AudioPath)}/song.yaml`,
          sidecarFor({
            title: String(v.fields.Name || "Version"),
            artist: mediatek.ARTIST,
            album: patch.title,
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

// The release for a st0 song id, owner-scoped so two users' ids cannot collide.
export async function getReleaseBySongUuid(ownerId, songUuid) {
  if (!songUuid) return null;
  const recs = await db.listRecords("Releases", {
    SongUuid: [songUuid],
    OwnerId: [ownerId],
  });
  return recs[0] ? publicRelease(recs[0]) : null;
}

export async function deleteRelease(uid) {
  const rec = await getReleaseRecord(uid);
  if (!rec) return false;
  const versions = await getVersionRecords(uid);
  for (const v of versions) await forgetVersionFolder(v);
  await db.deleteRecords(
    "Versions",
    versions.map((v) => v.id),
  );
  versions.forEach((v) => {
    safeUnlink(versionCachePath(v.fields.Uid));
    tracksOf(v).forEach((t) =>
      safeUnlink(versionTrackCachePath(v.fields.Uid, t)),
    );
  });
  await db.deleteRecords("Releases", [rec.id]);
  invalidateRelease(uid);
  invalidateVersions(uid);
  return true;
}

// --- Release versions -------------------------------------------------------

const versionsCache = new Map();

async function getVersionRecords(releaseUid) {
  const hit = versionsCache.get(releaseUid);
  if (hit && hit.exp > Date.now()) return hit.recs;
  const recs = await db.listRecords("Versions", {
    ReleaseUid: [releaseUid],
  });
  versionsCache.set(releaseUid, { recs, exp: Date.now() + SESSION_TTL_MS });
  return recs;
}

function invalidateVersions(releaseUid) {
  versionsCache.delete(releaseUid);
}

// A version carries a mixdown and, optionally, per-track stems; a web upload passes none.
export async function addVersion(
  releaseUid,
  { name, isDefault },
  mixdown: { buffer: Buffer; mime: string },
  tracks: { buffer: Buffer; mime: string; name?: string }[] = [],
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  const versionName = name || "Version";

  // A published version becomes a song under songs/K7/ — see ../../docs/audio.md.
  const release = await getReleaseRecord(releaseUid);
  const master = await mediatek.pushVersion(
    mixdown.buffer,
    versionExt(mixdown.mime),
    {
      album: release?.fields.Title || "",
      title: versionName,
    },
  );

  // Stems go in a `stems/` subfolder, out of reach of the scan that picks the master.
  const folder = dirOf(master);
  const stems: {
    id: string;
    path: string;
    name: string;
    mime: string;
  }[] = [];
  for (const [i, t] of tracks.entries()) {
    const entry = {
      id: String(i + 1),
      path: `${folder}/stems/${stemName(t, i)}`,
      name: t.name || `stem-${i + 1}`,
      mime: t.mime,
    };
    await mediatek.putFile(entry.path, t.buffer);
    stems.push(entry);
    fs.writeFileSync(versionTrackCachePath(uid, entry), t.buffer);
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
  fs.writeFileSync(versionCachePath(uid), mixdown.buffer);
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

/** The whole song folder out of the médiathèque, since the folder IS the version; never fatal. */
async function forgetVersionFolder(v) {
  if (!v?.fields.AudioPath) return;
  await mediatek.removeTree(dirOf(v.fields.AudioPath)).catch(() => {});
}

/** Swap a version's mixdown for another file, keeping its name, its stems and its place. */
export async function replaceVersionAudio(releaseUid, versionUid, mixdown) {
  const versions = await getVersionRecords(releaseUid);
  const rec = versions.find((v) => v.fields.Uid === versionUid);
  if (!rec) return null;
  const release = await getReleaseRecord(releaseUid);
  const previous = String(rec.fields.AudioPath || "");

  // The same album and title, so the bytes land in the folder this version already owns.
  const master = await mediatek.pushVersion(
    mixdown.buffer,
    versionExt(mixdown.mime),
    {
      album: release?.fields.Title || "",
      title: String(rec.fields.Name || "Version"),
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

  fs.writeFileSync(versionCachePath(versionUid), mixdown.buffer);
  invalidateVersions(releaseUid);
  return getRelease(releaseUid);
}

export async function setDefaultVersion(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const target = versions.find((v) => v.fields.Uid === versionUid);
  if (!target) return null;
  for (const v of versions) {
    const shouldBe = v.fields.Uid === versionUid;
    if (Boolean(v.fields.IsDefault) !== shouldBe) {
      await db.patchRecord("Versions", v.id, { IsDefault: shouldBe });
    }
  }
  invalidateVersions(releaseUid);
  return true;
}

/** Hidden keeps a version out of a page's dropdown, and a page that chose it falls back to the default. */
export async function setVersionHidden(releaseUid, versionUid, hidden) {
  const versions = await getVersionRecords(releaseUid);
  const v = versions.find((x) => x.fields.Uid === versionUid);
  if (!v) return null;
  await db.patchRecord("Versions", v.id, { Hidden: Boolean(hidden) });
  invalidateVersions(releaseUid);
  return true;
}

export async function renameVersion(releaseUid, versionUid, name) {
  const versions = await getVersionRecords(releaseUid);
  const v = versions.find((x) => x.fields.Uid === versionUid);
  if (!v) return null;
  await db.patchRecord("Versions", v.id, { Name: String(name) });
  // The folder keeps its name and only the sidecar is rewritten — ../../docs/audio.md.
  if (v.fields.AudioPath) {
    const release = await getReleaseRecord(releaseUid);
    await mediatek
      .putFile(
        `${dirOf(v.fields.AudioPath)}/song.yaml`,
        sidecarFor({
          title: String(name),
          artist: mediatek.ARTIST,
          album: release?.fields.Title || "",
          source: "k7",
        }),
      )
      .catch(() => {
        // A stale title in the library is worth less than a rename that fails.
      });
  }
  invalidateVersions(releaseUid);
  return true;
}

export async function deleteVersion(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const v = versions.find((x) => x.fields.Uid === versionUid);
  if (!v) return false;
  await forgetVersionFolder(v);
  await db.deleteRecords("Versions", [v.id]);
  safeUnlink(versionCachePath(versionUid));
  tracksOf(v).forEach((t) => safeUnlink(versionTrackCachePath(versionUid, t)));
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

/** A version's shape, measured on first ask and kept: decoding is seconds, drawing must not be. */
export async function versionEnvelope(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const rec = versions.find((v) => v.fields.Uid === versionUid);
  if (!rec?.fields.AudioPath) return null;
  const stored = String(rec.fields.Envelope || "");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SongEnvelope;
      if (parsed?.samples?.length) return parsed;
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

export async function ensureVersionAudioCached(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const rec = versions.find((v) => v.fields.Uid === versionUid);
  if (!rec?.fields.AudioPath) return null;
  const remote = String(rec.fields.AudioPath);
  const mime = mediatek.streamedMime(
    remote,
    rec.fields.AudioMime || "audio/mpeg",
  );
  const filePath = versionCachePath(versionUid);
  if (!fs.existsSync(filePath))
    await mediatek.downloadStreamable(remote, filePath);
  return { filePath, mime };
}

function versionCachePath(uid) {
  return path.join(CACHE_DIR, `version-${uid}`);
}

/** The extension a version's mixdown is FILED under; `bin` is not audio to the zone, so mp3. */
function versionExt(mime) {
  const ext = audioExtFor(mime);
  return ext === "bin" ? "mp3" : ext;
}

/** "Artist - Title (Version).ext": what a downloaded version is saved as. */
export function versionFileName(release, version, mime) {
  return `${release.artist} - ${release.title} (${version.name}).${versionExt(mime)}`;
}

/** A stem's file name under `stems/`: its own name, made nameable, plus its extension. */
function stemName(track, i) {
  const stem = segment(track.name || "", `stem-${i + 1}`);
  return `${stem}.${versionExt(track.mime)}`;
}

/** The folder holding a file, in the médiathèque's POSIX path space. */
function dirOf(p) {
  return String(p).split("/").slice(0, -1).join("/");
}

function audioExtFor(mime) {
  if (!mime) return "bin";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac"))
    return "m4a";
  if (mime.includes("webm")) return "webm";
  return "bin";
}

// Per-stem cache key: the stem's rank in the version, plus an ext the browser can sniff.
function versionTrackCachePath(versionUid, entry) {
  return path.join(
    CACHE_DIR,
    `version-${versionUid}-${entry.id}.${audioExtFor(entry.mime)}`,
  );
}

/** A version's stem on disk, fetched from the médiathèque; { filePath, mime, name } or null. */
export async function ensureVersionTrackCached(
  releaseUid,
  versionUid,
  trackId,
) {
  const versions = await getVersionRecords(releaseUid);
  const rec = versions.find((v) => v.fields.Uid === versionUid);
  if (!rec) return null;
  const entry = tracksOf(rec).find((t) => t.id === trackId);
  if (!entry?.path) return null;
  const mime = mediatek.streamedMime(entry.path, entry.mime);
  const filePath = versionTrackCachePath(versionUid, { ...entry, mime });
  if (!fs.existsSync(filePath))
    await mediatek.downloadStreamable(entry.path, filePath);
  return { filePath, mime, name: entry.name };
}

// --- Pages (a named collection of releases) ---------------------------------

function publicPage(rec) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    nametag: f.Nametag || "",
    releaseIds: String(f.ReleaseUids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    versionIds: versionChoicesOf(rec),
    createdAt: f.CreatedAt || "",
  };
}

// VersionChoices is a JSON object { releaseUid: versionUid }; anything else reads as "no choice".
function versionChoicesOf(rec): Record<string, string> {
  try {
    const parsed = JSON.parse(rec.fields.VersionChoices || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function getPageRecord(uid) {
  const recs = await db.listRecords("Pages", { Uid: [uid] });
  return recs[0] || null;
}

export async function getPageOwner(uid) {
  const rec = await getPageRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function nametagExists(nametag, exceptUid?) {
  const recs = await db.listRecords("Pages", { Nametag: [nametag] });
  return recs.some((r) => r.fields.Uid !== exceptUid);
}

// The nametag is the whole address of a public page — see routes/publicPages.ts.
export async function getPageByNametag(nametag) {
  const recs = await db.listRecords("Pages", { Nametag: [nametag] });
  return recs[0] ? getPage(recs[0].fields.Uid) : null;
}

export async function listPages(ownerId) {
  const recs = await db.listRecords("Pages", { OwnerId: [ownerId] });
  return recs
    .map(publicPage)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getPage(uid) {
  const rec = await getPageRecord(uid);
  if (!rec) return null;
  const page = publicPage(rec);
  const releases: Release[] = [];
  for (const rid of page.releaseIds) {
    const r = await getRelease(rid);
    if (r && r.ownerId === page.ownerId) releases.push(r);
  }
  return { ...page, releases };
}

export async function createPage(ownerId, { nametag, releaseIds }) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Pages", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Nametag: nametag,
      ReleaseUids: (releaseIds || []).join(","),
      CreatedAt: createdAt,
    },
  ]);
  return getPage(uid);
}

export async function updatePage(uid, patch) {
  const rec = await getPageRecord(uid);
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.nametag !== undefined) fields.Nametag = patch.nametag;
  if (patch.releaseIds !== undefined)
    fields.ReleaseUids = patch.releaseIds.join(",");
  if (patch.versionIds !== undefined)
    fields.VersionChoices = JSON.stringify(patch.versionIds);
  await db.patchRecord("Pages", rec.id, fields);
  return getPage(uid);
}

export async function deletePage(uid) {
  const rec = await getPageRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("Pages", [rec.id]);
  return true;
}

// --- Singing exercises (a personal practice book: what to sing, and how) ----

function publicSinging(rec, viewer = "") {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    title: f.Title || "",
    description: f.Description || "",
    videoUrl: f.VideoUrl || "",
    // The asking user wrote it, which is what lets them delete it — ../../docs/ownership.md.
    mine: Boolean(viewer) && f.OwnerId === viewer,
    createdAt: f.CreatedAt || "",
  };
}

async function getSingingRecord(uid) {
  const recs = await db.listRecords("SingingExercises", { Uid: [uid] });
  return recs[0] || null;
}

export async function getSingingExerciseOwner(uid) {
  const rec = await getSingingRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function listSingingExercises(viewer = "") {
  // Everyone's, not the viewer's: the practice book is common ground, like the songbook.
  const recs = await db.listRecords("SingingExercises");
  return recs
    .map((rec) => publicSinging(rec, viewer))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createSingingExercise(
  ownerId,
  { title, description, videoUrl },
) {
  const uid = randomUUID();
  await db.addRecords("SingingExercises", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Title: title,
      Description: description || "",
      VideoUrl: videoUrl || "",
      CreatedAt: new Date().toISOString(),
    },
  ]);
  const rec = await getSingingRecord(uid);
  return rec ? publicSinging(rec) : null;
}

export async function updateSingingExercise(uid, patch, viewer = "") {
  const rec = await getSingingRecord(uid);
  if (!rec) return null;
  // Typed, or an empty literal infers `{}` and refuses every key put in it.
  const fields: Record<string, string> = {};
  if (patch.title !== undefined) fields.Title = patch.title;
  if (patch.description !== undefined) fields.Description = patch.description;
  if (patch.videoUrl !== undefined) fields.VideoUrl = patch.videoUrl;
  if (Object.keys(fields).length)
    await db.patchRecord("SingingExercises", rec.id, fields);
  const after = await getSingingRecord(uid);
  return after ? publicSinging(after, viewer) : null;
}

export async function deleteSingingExercise(uid) {
  const rec = await getSingingRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("SingingExercises", [rec.id]);
  return true;
}

// --- Songs (songbook: lyrics / tablature / sheet, all free text) ------------

const songCache = new Map();

async function getSongRecord(uid) {
  const hit = songCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await db.listRecords("Songs", { Uid: [uid] });
  const rec = recs[0] || null;
  songCache.set(uid, { rec, exp: Date.now() + SESSION_TTL_MS });
  return rec;
}

function invalidateSong(uid) {
  songCache.delete(uid);
}

function sheetsOf(rec) {
  // SheetMeta is a JSON array of { id, name, mime }, one per SheetFiles attachment, in order.
  try {
    const parsed = JSON.parse(rec.fields.SheetMeta || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The stored lyric timecodes, or none when the column is empty or unreadable — ../../docs/lyricsTiming.md. */
function timingsOf(rec) {
  try {
    const parsed = JSON.parse(rec.fields.LyricTimings || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The song uids `ownerId` starred: a favourite is a person's, not the song's — ../../docs/ownership.md. */
async function favoritesOf(ownerId): Promise<Set<string>> {
  if (!ownerId) return new Set();
  const recs = await db.listRecords("SongFavorites", { OwnerId: [ownerId] });
  return new Set(recs.map((r) => String(r.fields.SongUid)));
}

/** A song as `viewer` sees it: everyone reads the same song, the star and `mine` are theirs. */
function publicSong(rec, viewer = "", favorites: Set<string> = new Set()) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    mine: Boolean(viewer) && f.OwnerId === viewer,
    artist: f.Artist || "",
    title: f.Title || "",
    lyrics: f.Lyrics || "",
    lyricTimings: timingsOf(rec),
    tablature: f.Tablature || "",
    sheets: sheetsOf(rec).map((s) => ({
      id: s.id,
      name: s.name,
      mime: s.mime,
    })),
    // The library file the page streams from pl8 — k7 keeps no copy, ../../docs/audio.md.
    audio: libraryPath(f.AudioPath)
      ? { name: f.AudioName || "", mime: f.AudioMime || "", path: f.AudioPath }
      : null,
    // The same track without the voice, the one an engine's chain wrote beside the song's stems.
    instrumental: libraryPath(f.InstrumentalPath)
      ? {
          name: f.InstrumentalName || "",
          mime: f.InstrumentalMime || "",
          path: f.InstrumentalPath,
        }
      : null,
    // The auto-fetch pipeline's own state — fetchSong/run.ts's runPipeline reads and writes it.
    fetchStatus: {
      phase: f.FetchPhase || "",
      progress: f.FetchProgress ? Number(f.FetchProgress) : null,
      error: f.FetchError || "",
      huntId: f.FetchHuntId || "",
      jobId: f.FetchJobId || "",
    },
    lyricsMatch: f.LyricsMatch || "",
    fetchIgnored: Boolean(f.FetchIgnored),
    favorite: favorites.has(f.Uid),
    createdAt: f.CreatedAt || "",
  };
}

export async function getSongOwner(uid) {
  const rec = await getSongRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

/** Every song — the songbook is shared — with `viewer`'s favourites floated to the top. */
export async function listSongs(viewer = "") {
  const [recs, favorites] = await Promise.all([
    db.listRecords("Songs"),
    favoritesOf(viewer),
  ]);
  return recs
    .map((rec) => publicSong(rec, viewer, favorites))
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.artist.localeCompare(b.artist) ||
        a.title.localeCompare(b.title),
    );
}

export async function getSong(uid, viewer = "") {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  return publicSong(rec, viewer, await favoritesOf(viewer));
}

/** Star or unstar a song for `viewer` alone; null when there is no such song. */
export async function setSongFavorite(uid, viewer, favorite: boolean) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const mine = await db.listRecords("SongFavorites", {
    OwnerId: [viewer],
    SongUid: [uid],
  });
  if (favorite && mine.length === 0)
    await db.addRecords("SongFavorites", [{ SongUid: uid, OwnerId: viewer }]);
  if (!favorite && mine.length > 0)
    await db.deleteRecords(
      "SongFavorites",
      mine.map((r) => r.id),
    );
  return getSong(uid, viewer);
}

export async function createSong(ownerId, { artist, title }) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Songs", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Artist: artist,
      Title: title,
      Lyrics: "",
      Tablature: "",
      SheetMeta: "[]",
      CreatedAt: createdAt,
    },
  ]);
  invalidateSong(uid);
  return getSong(uid);
}

export async function updateSong(uid, patch) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.artist !== undefined) fields.Artist = String(patch.artist);
  if (patch.title !== undefined) fields.Title = String(patch.title);
  if (patch.lyrics !== undefined) fields.Lyrics = String(patch.lyrics);
  if (patch.tablature !== undefined) fields.Tablature = String(patch.tablature);
  if (patch.lyricTimings !== undefined)
    fields.LyricTimings = JSON.stringify(patch.lyricTimings);
  if (patch.fetchStatus !== undefined) {
    const s = patch.fetchStatus;
    if (s.phase !== undefined) fields.FetchPhase = String(s.phase);
    if (s.progress !== undefined) fields.FetchProgress = s.progress ?? 0;
    if (s.error !== undefined) fields.FetchError = String(s.error);
    if (s.huntId !== undefined) fields.FetchHuntId = String(s.huntId);
    if (s.jobId !== undefined) fields.FetchJobId = String(s.jobId);
  }
  if (patch.lyricsMatch !== undefined)
    fields.LyricsMatch = String(patch.lyricsMatch);
  if (patch.fetchIgnored !== undefined)
    fields.FetchIgnored = Boolean(patch.fetchIgnored);
  await db.patchRecord("Songs", rec.id, fields);
  invalidateSong(uid);
  return getSong(uid);
}

export async function deleteSong(uid) {
  const rec = await getSongRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("Songs", [rec.id]);
  invalidateSong(uid);
  return true;
}

// --- Song sheets (PDF / image / MusicXML files — not audio, so PocketBase holds them) -------

// SheetMeta is the order, name and type; the bytes live in the song_sheets collection.
async function writeSheets(rec, sheets) {
  await db.patchRecord("Songs", rec.id, {
    SheetMeta: JSON.stringify(sheets),
  });
}

// Upload { buffer, mime, name } files onto a song's sheet, after the existing ones.
export async function addSheetFiles(uid, files) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const existing = sheetsOf(rec);
  const added: {
    id: string;
    attachmentId: string;
    name: string;
    mime: string;
  }[] = [];
  for (const file of files) {
    const name = file.name || "sheet";
    const attachmentId = await db.uploadAttachment(
      file.buffer,
      file.mime,
      name,
      rec.id,
    );
    const entry = {
      id: attachmentId,
      attachmentId,
      name,
      mime: file.mime,
    };
    added.push(entry);
    // Prime the disk cache so the first view streams straight away.
    fs.writeFileSync(sheetCachePath(uid, entry), file.buffer);
  }
  await writeSheets(rec, [...existing, ...added]);
  invalidateSong(uid);
  return getSong(uid);
}

// Remove a single sheet file (by its public id) from a song.
export async function deleteSheetFile(uid, fileId) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const existing = sheetsOf(rec);
  const gone = existing.find((s) => s.id === fileId);
  if (!gone) return getSong(uid);
  await writeSheets(
    rec,
    existing.filter((s) => s.id !== fileId),
  );
  await db.deleteAttachment(gone.attachmentId).catch(() => {
    // The metadata row is what the songbook reads; a stray blob left behind is not fatal.
  });
  safeUnlink(sheetCachePath(uid, gone));
  invalidateSong(uid);
  return getSong(uid);
}

// --- The reference track: a LINK to a song of pl8's library, streamed from there -------------------

/** A song's track is a file of pl8's songs family or nothing: k7 stores, copies and plays no file of its own. */
function libraryPath(p): string {
  const path = String(p || "");
  return path.startsWith("songs/") ? path : "";
}

/** Point the song at a library master; the browser streams it from pl8 — ../../docs/audio.md. */
export async function linkSongAudio(uid, { path: master, mime, name }) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const previous = rec.fields.AudioPath ? String(rec.fields.AudioPath) : "";
  await db.patchRecord("Songs", rec.id, {
    AudioPath: master,
    AudioMime: mime,
    AudioName: name,
    // Another track has another shape; the next reader measures this one.
    Envelope: "",
  });
  // An instrumental made from the old track is not this track's.
  if (previous !== master) await clearInstrumental(uid, rec);
  invalidateSong(uid);
  return getSong(uid);
}

/** An uploaded track goes INTO the library, as this song, and the song links to it. */
export async function setSongAudio(uid, { buffer, mime, name }) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const artist = String(rec.fields.Artist || "");
  const title = String(rec.fields.Title || "");
  const master = await mediatek.pushSongTrack(buffer, {
    filename: `${artist} - ${title}.${songAudioExt(mime, name)}`,
    artist,
    title,
  });
  return linkSongAudio(uid, { path: master, mime, name });
}

/** The song stops pointing at its library track and instrumental; the library keeps both files. */
export async function unlinkSongAudio(uid) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await db.patchRecord("Songs", rec.id, {
    AudioPath: "",
    AudioMime: "",
    AudioName: "",
    Envelope: "",
  });
  await clearInstrumental(uid, rec);
  invalidateSong(uid);
  return getSong(uid);
}

// --- The instrumental: the one an engine's chain wrote beside the library song's stems ------------

/** Forget a song's instrumental link — also what a new track calls; the library keeps the file. */
async function clearInstrumental(uid, rec) {
  if (!rec.fields.InstrumentalPath) return;
  await db.patchRecord("Songs", rec.id, {
    InstrumentalPath: "",
    InstrumentalMime: "",
    InstrumentalName: "",
  });
}

export async function linkSongInstrumental(uid, { path: file, mime, name }) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await db.patchRecord("Songs", rec.id, {
    InstrumentalPath: file,
    InstrumentalMime: mime,
    InstrumentalName: name,
  });
  invalidateSong(uid);
  return getSong(uid);
}

export async function deleteSongInstrumental(uid) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  await clearInstrumental(uid, rec);
  invalidateSong(uid);
  return getSong(uid);
}

/** The track's shape, measured on first ask and kept: decoding is seconds, drawing must not be. */
export async function songEnvelope(uid) {
  const rec = await getSongRecord(uid);
  const track = libraryPath(rec?.fields.AudioPath);
  if (!track) return null;
  const stored = String(rec.fields.Envelope || "");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SongEnvelope;
      if (parsed?.samples?.length) return parsed;
    } catch {
      // Unreadable is the same as absent: measure it again rather than refuse to draw.
    }
  }
  // pl8 already holds the bytes and has ffmpeg — no local download needed to measure them.
  const measured = await envelopeOf(track);
  await db.patchRecord("Songs", rec.id, {
    Envelope: JSON.stringify(measured),
  });
  invalidateSong(uid);
  return measured;
}

/** A sheet file on disk, fetched from PocketBase if need be, so it can be streamed. */
export async function ensureSheetFileCached(uid, fileId) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const entry = sheetsOf(rec).find((s) => s.id === fileId);
  if (!entry) return null;
  const filePath = sheetCachePath(uid, entry);
  if (!fs.existsSync(filePath)) {
    const buffer = await db.downloadAttachment(entry.attachmentId);
    fs.writeFileSync(filePath, buffer);
  }
  return { filePath, mime: entry.mime, name: entry.name };
}

// --- helpers ----------------------------------------------------------------

function parseTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  const out: string[] = [];
  for (const t of list) {
    const clean = String(t).trim().replace(/^#/, "");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function extFor(mime) {
  return mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";
}

function cachePathFor(rec) {
  if (!rec) return null;
  return path.join(
    CACHE_DIR,
    `${rec.fields.Uid}.${extFor(rec.fields.RecordingMime || "")}`,
  );
}

/** Common audio containers, then the uploaded name's own extension, then `bin`. */
function songAudioExt(mime, name) {
  const known = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/webm": "webm",
  };
  if (known[mime]) return known[mime];
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return fromName ? fromName[1].toLowerCase() : "bin";
}

/** The médiathèque may already have lost it; that is not a failure worth raising. */
async function safeRemote(remote) {
  try {
    await mediatek.remove(remote);
  } catch {
    /* already gone, or unreachable — the row is what matters */
  }
}

// One sheet file's cache path: keyed by its own id, with a sniffable extension.
function sheetCachePath(uid, entry) {
  return path.join(
    CACHE_DIR,
    `sheet-${uid}-${entry.id}.${sheetExt(entry.name ?? "", entry.mime)}`,
  );
}

function safeUnlink(p) {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
