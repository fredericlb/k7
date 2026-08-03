// Data access for sessions, highlights and comments — backed by Grist.
//
// - Session metadata, the loudness envelope (JSON), highlights and comments
//   live in Grist tables (see migrate.js for the schema).
// - The recording's BYTES live in the médiathèque's RECORDINGS zone; Grist keeps
//   only the path to them. Cached on local disk so it can be streamed with HTTP
//   Range for fast seeking. See docs/audio.md.
// - A short in-memory cache of session rows keeps range requests / ownership
//   checks from hitting Grist on every call.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Annotation, Envelope, Marker, Release } from "@k7/shared";
import { segment, sidecarFor } from "@studio/mediatek/morceau";
import * as grist from "./grist.ts";
import * as mediatek from "./mediatek.ts";

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
  const recs = await grist.listRecords("Sessions", { Uid: [uid] });
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
  const recs = await grist.listRecords("Releases", { Uid: [uid] });
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
    // The PATH is what says there is audio, not the flag beside it. A row from before the
    // médiathèque carries `HasRecording: true` and points at nothing, and a session that
    // announces a recording it cannot play is worse than one that admits it has none.
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
  const recs = await grist.listRecords("Sessions", { OwnerId: [ownerId] });
  const uids = recs.map((r) => r.fields.Uid);
  const comments = uids.length
    ? await grist.listRecords("Comments", { SessionUid: uids })
    : [];
  const markers = uids.length
    ? await grist.listRecords("Markers", { SessionUid: uids })
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
  const comments = await grist.listRecords("Comments", { SessionUid: [uid] });
  s.annotations = comments
    .map(mapComment)
    .sort((a, b) => a.startSec - b.startSec);
  const markers = await grist.listRecords("Markers", { SessionUid: [uid] });
  s.markers = markers.map(mapMarker).sort((a, b) => a.atSec - b.atSec);
  return s;
}

export async function createSession(ownerId) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await grist.addRecords("Sessions", [
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
  const highlights = await grist.listRecords("Highlights", {
    SessionUid: [uid],
  });
  await grist.deleteRecords(
    "Highlights",
    highlights.map((h) => h.id),
  );
  // Markers are session-scoped (unlike moments) — remove them with the session.
  const markers = await grist.listRecords("Markers", { SessionUid: [uid] });
  await grist.deleteRecords(
    "Markers",
    markers.map((m) => m.id),
  );
  // Moments (Comments) intentionally survive — they're standalone entities with
  // their own extracted clips; they just lose the link back to this session.
  // The bytes go too, and BEFORE the row: the path lives on that row, so deleting it first
  // would leave a capture in the zone that nothing points at any more.
  if (rec?.fields.RecordingPath)
    await mediatek.remove(rec.fields.RecordingPath).catch(() => {
      // A library that is down must not block deleting a session. The capture is then
      // orphaned in the zone, which is visible and removable — unlike a row that refused
      // to disappear.
    });
  if (rec) await grist.deleteRecords("Sessions", [rec.id]);
  invalidate(uid);
  safeUnlink(cachePathFor(rec));
  return Boolean(rec);
}

// --- Recording + envelope ---------------------------------------------------

/**
 * Put a session's bytes in the médiathèque and answer where they went.
 *
 * One helper for the three ways in — first save, re-save, continued session — because the
 * rule is the same for all three and it has one subtlety: a session that already owns a
 * file of the RIGHT format keeps it, rewritten in place. A session is one recording, so
 * pushing a second capture would show two takes in the zone where there is one session.
 *
 * A format change is the exception: the combined take is always webm, so a session that
 * started in ogg gets a new file and the old one goes — after the new bytes landed, never
 * before, so a failed push leaves the playable one behind.
 */
async function storeBytes(rec, buffer, ext) {
  const previous = rec.fields.RecordingPath || "";
  if (previous.endsWith(`.${mediatek.zoneExt(ext)}`)) {
    await mediatek.replace(previous, buffer);
    return previous;
  }
  // The session's OWN moment, not now: a take uploaded after midnight belongs to the
  // evening it was played, which is the date the zone files it under.
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
  await grist.patchRecord("Sessions", rec.id, {
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

// Continue a saved session: concatenate the new take onto the existing
// recording (audio + envelope + duration), so the session grows in place. Falls
// back to a plain save when there's nothing to append to yet.
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
  // Nothing to append TO — including a row from before the médiathèque, whose flag says
  // there is and whose path says there is not. The path decides.
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

  // Append the new envelope samples after the existing timeline. Each take is
  // normalized to its own peak, so the two halves can differ slightly in
  // vertical scale — acceptable for a loudness overview.
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
  // gain == 0.9 / truePeak, so the smaller value clears the louder of the two
  // peaks — keeping combined playback below clipping.
  const combinedGain = Math.min(prevGain, gain || 1);
  const combinedMime = "audio/webm";

  const recordingPath = await storeBytes(rec, combined, "webm");
  const oldCache = cachePathFor(rec);
  await grist.patchRecord("Sessions", rec.id, {
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

  // Refresh the disk cache: the combined file is always webm, so drop any
  // stale differently-typed cache file before writing the new one.
  const newCache = path.join(CACHE_DIR, `${uid}.webm`);
  if (oldCache && oldCache !== newCache) safeUnlink(oldCache);
  fs.writeFileSync(newCache, combined);
  invalidate(uid);
  return getSession(uid);
}

/**
 * Make sure the recording is on disk so it can be streamed with Range support.
 * Returns { filePath, mime } or null.
 *
 * One source: the médiathèque. A row with no `RecordingPath` has no audio anywhere — see
 * docs/audio.md, "on repart de zéro".
 */
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
  const existing = await grist.listRecords("Highlights", { SessionUid: [uid] });
  await grist.deleteRecords(
    "Highlights",
    existing.map((h) => h.id),
  );
  if (events.length) {
    await grist.addRecords(
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
  // OwnerId is stored on the moment itself so it stays owner-addressable even
  // after its session is deleted; fall back to the session's owner if omitted.
  const owner = ownerId || (await getOwner(uid));
  const [{ id }] = await grist.addRecords("Comments", [
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
  // Extract the standalone clip right away so every saved moment is immediately
  // playable on its own. Best-effort: a session without a recording yet (or a
  // missing ffmpeg) just leaves the moment unextracted.
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
  const before = (
    await grist.listRecords("Comments", { SessionUid: [uid] })
  ).find((r) => r.id === Number(annId));
  if (!before) return null;

  const fields: Record<string, unknown> = {};
  if (patch.startSec !== undefined) fields.StartSec = Number(patch.startSec);
  if (patch.endSec !== undefined) fields.EndSec = Number(patch.endSec);
  if (patch.text !== undefined) fields.Text = String(patch.text);
  if (patch.tags !== undefined)
    fields.Tags = normalizeTags(patch.tags).join(",");
  await grist.patchRecord("Comments", Number(annId), fields);

  // If the timespan moved, the previously extracted clip no longer matches —
  // drop it and re-extract the new range.
  const rangeChanged =
    (fields.StartSec !== undefined &&
      fields.StartSec !== Number(before.fields.StartSec)) ||
    (fields.EndSec !== undefined &&
      fields.EndSec !== Number(before.fields.EndSec));
  if (rangeChanged) {
    safeUnlink(clipCachePath(Number(annId)));
    await extractMomentClip(uid, {
      id: Number(annId),
      fields: { ...before.fields, ...fields },
    }).catch((e) => console.error("moment auto re-extract failed:", e.message));
  }

  const recs = await grist.listRecords("Comments", { SessionUid: [uid] });
  const rec = recs.find((r) => r.id === Number(annId));
  return rec ? mapComment(rec) : null;
}

export async function deleteAnnotation(uid, annId) {
  const recs = await grist.listRecords("Comments", { SessionUid: [uid] });
  await forgetClip(recs.find((r) => r.id === Number(annId)));
  await grist.deleteRecords("Comments", [Number(annId)]);
  safeUnlink(clipCachePath(annId));
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
  const [{ id }] = await grist.addRecords("Markers", [
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
  const fields: Record<string, unknown> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await grist.patchRecord("Markers", Number(markerId), fields);
  const recs = await grist.listRecords("Markers", { SessionUid: [uid] });
  const rec = recs.find((r) => r.id === Number(markerId));
  return rec ? mapMarker(rec) : null;
}

export async function deleteMarker(_uid, markerId) {
  await grist.deleteRecords("Markers", [Number(markerId)]);
  return true;
}

// --- Standalone moments -----------------------------------------------------
// Moments have their own owner-addressable view, independent of the session
// they were captured in (which may since have been deleted).

function publicMoment(rec, createdAtByUid) {
  const uid = rec.fields.SessionUid;
  return {
    ...mapComment(rec),
    // Sessions have no name — surface the originating session's date/time so the
    // client can label the moment with it. Null once that session is deleted.
    sessionCreatedAt: createdAtByUid.get(uid) ?? null,
    sessionAvailable: createdAtByUid.has(uid),
  };
}

async function ownerSessionCreatedAt(ownerId) {
  const sessions = await grist.listRecords("Sessions", { OwnerId: [ownerId] });
  return new Map(sessions.map((s) => [s.fields.Uid, s.fields.CreatedAt || ""]));
}

export async function listMoments(ownerId) {
  const recs = await grist.listRecords("Comments", { OwnerId: [ownerId] });
  const createdAtByUid = await ownerSessionCreatedAt(ownerId);
  return recs
    .map((r) => publicMoment(r, createdAtByUid))
    .sort(
      (a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        a.startSec - b.startSec,
    );
}

/** A moment by its own id, scoped to (and verified against) its owner. Includes
 *  its own waveform envelope and markers so its view can render a full player. */
export async function getMoment(ownerId, momentId) {
  const recs = await grist.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === Number(momentId));
  if (!rec) return null;
  const createdAtByUid = await ownerSessionCreatedAt(ownerId);
  const base = publicMoment(rec, createdAtByUid);

  // Envelope: the stored slice, or sliced live from the session if it's still
  // around (covers moments extracted before envelopes were stored).
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
  const recs = await grist.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === Number(momentId));
  if (!rec) return false;
  await forgetClip(rec);
  await grist.deleteRecords("Comments", [rec.id]);
  safeUnlink(clipCachePath(rec.id));
  return true;
}

/** Take a moment's clip out of the zone. Before the row goes, since the row is what holds
 *  the path — and never fatal: an orphan in the zone is visible and removable, a moment
 *  that refuses to disappear is not. */
async function forgetClip(rec) {
  if (!rec?.fields.ClipPath) return;
  await mediatek.remove(rec.fields.ClipPath).catch(() => {});
}

/** Ensure a moment's clip is cached, looked up by owner + moment id alone. */
export async function ensureMomentClipCached(ownerId, momentId) {
  const filePath = clipCachePath(momentId);
  if (fs.existsSync(filePath)) return { filePath, mime: "audio/webm" };
  const recs = await grist.listRecords("Comments", { OwnerId: [ownerId] });
  const rec = recs.find((r) => r.id === Number(momentId));
  if (!rec?.fields.ClipPath) return null;
  await mediatek.download(String(rec.fields.ClipPath), filePath);
  return { filePath, mime: "audio/webm" };
}

// --- Moment markers ---------------------------------------------------------
// Pins on a moment's own clip timeline, stored in the shared Markers table but
// keyed by MomentId (session markers use SessionUid instead), owner-scoped.

export async function listMomentMarkers(ownerId, momentId) {
  const recs = await grist.listRecords("Markers", {
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
  const [{ id }] = await grist.addRecords("Markers", [
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
  const recs = await grist.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  const rec = recs.find(
    (r) => r.id === Number(markerId) && r.fields.OwnerId === ownerId,
  );
  if (!rec) return null;
  const fields: Record<string, unknown> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await grist.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export async function deleteMomentMarker(ownerId, momentId, markerId) {
  const recs = await grist.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  const rec = recs.find(
    (r) => r.id === Number(markerId) && r.fields.OwnerId === ownerId,
  );
  if (!rec) return false;
  await grist.deleteRecords("Markers", [rec.id]);
  return true;
}

// --- Moment validation (extract a standalone clip) --------------------------

// Cut a moment's exact timespan out of the session recording into a standalone
// audio clip (stored as the moment's own attachment + disk cache). The moment
// keeps its link back to the session via SessionUid + StartSec. Shared by the
// automatic extraction on save/edit and the manual re-extract below. Returns
// false when the session has no recording yet (nothing to clip).
async function extractMomentClip(sessionUid, rec) {
  const info = await ensureRecordingCached(sessionUid);
  if (!info) return false;

  const start = Number(rec.fields.StartSec);
  const end = Number(rec.fields.EndSec);
  const clip = await extractClip(info.filePath, start, end);

  // Store the moment's own envelope (the session envelope sliced to its span) so
  // its standalone view can draw a full waveform even after the session is gone.
  const sessionEnv = await getEnvelope(sessionUid);
  const sliced = sessionEnv ? sliceEnvelope(sessionEnv, start, end) : null;

  // The clip goes in the zone, beside the session it was cut from. Re-extracting replaces
  // it: the span or the name may have moved, so the old file's name is now a lie.
  const previous = rec.fields.ClipPath;
  const clipPath = await mediatek.pushMoment(clip, "webm", {
    at: momentPlayedAt(await getSessionRecord(sessionUid), start),
    durationSec: end - start,
    label: rec.fields.Text,
  });
  if (previous && previous !== clipPath) await mediatek.remove(previous);

  await grist.patchRecord("Comments", rec.id, {
    Validated: true,
    ClipPath: clipPath,
    Envelope: sliced ? JSON.stringify(sliced) : "",
  });
  fs.writeFileSync(clipCachePath(rec.id), clip);
  return true;
}

/** When a moment was PLAYED: the session's start plus its offset inside it. Not the
 *  annotation's own CreatedAt, which is when somebody listened back — possibly days later,
 *  and under a date the zone would then file it by. */
function momentPlayedAt(sessionRec, startSec) {
  const started = sessionRec?.fields.CreatedAt
    ? new Date(sessionRec.fields.CreatedAt)
    : null;
  if (!started || Number.isNaN(started.getTime())) return undefined;
  return new Date(started.getTime() + Math.max(0, startSec) * 1000);
}

// The session envelope samples covering [startSec, endSec], re-based to a clip
// timeline that starts at 0.
function sliceEnvelope(env, startSec, endSec) {
  const per = (env.intervalMs || 200) / 1000;
  const i0 = Math.max(0, Math.floor(startSec / per));
  const i1 = Math.min(env.samples.length, Math.ceil(endSec / per));
  return {
    intervalMs: env.intervalMs || 200,
    samples: env.samples.slice(i0, i1),
  };
}

// Manual re-extract, kept as a fallback for when auto-extraction couldn't run
// (e.g. the moment was created before its recording existed, or ffmpeg failed).
export async function validateMoment(sessionUid, momentId) {
  const moments = await grist.listRecords("Comments", {
    SessionUid: [sessionUid],
  });
  const rec = moments.find((m) => m.id === Number(momentId));
  if (!rec) return null;
  const ok = await extractMomentClip(sessionUid, rec);
  if (!ok) throw new Error("session has no recording to clip");
  return mapComment({ id: rec.id, fields: { ...rec.fields, Validated: true } });
}

/** Ensure a validated moment's clip is on disk; returns { filePath, mime }. */
export async function ensureClipCached(sessionUid, momentId) {
  const filePath = clipCachePath(momentId);
  if (fs.existsSync(filePath)) return { filePath, mime: "audio/webm" };
  const moments = await grist.listRecords("Comments", {
    SessionUid: [sessionUid],
  });
  const rec = moments.find((m) => m.id === Number(momentId));
  if (!rec?.fields.ClipPath) return null;
  await mediatek.download(String(rec.fields.ClipPath), filePath);
  return { filePath, mime: "audio/webm" };
}

function clipCachePath(momentId) {
  return path.join(CACHE_DIR, `clip-${momentId}.webm`);
}

// Concatenate several audio files into one webm/opus buffer using ffmpeg's
// concat filter (re-encodes, so mismatched source codecs/params are fine).
function concatRecordings(paths) {
  return new Promise<Buffer>((resolve, reject) => {
    const outPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.webm`);
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    for (const p of paths) args.push("-i", p);
    // The concat filter needs identical parameters across segments — coerce each
    // input to a common format first so takes from different devices still join.
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
      // EBU R128 loudness normalization so the standalone clip sits at a
      // consistent, healthy level (target -14 LUFS, true peak -1 dBTP).
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

// TrackMeta is a JSON array of { id, attachmentId, name, mime } — one per stem,
// in order. Tolerate a missing/garbled value. Mirrors sheetsOf.
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
  const recs = await grist.listRecords("Releases", { OwnerId: [ownerId] });
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
  await grist.addRecords("Releases", [
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

// Find the release for a pistes song id, scoped to its owner so ids from
// different users can't collide. Returns the public release or null.
export async function getReleaseBySongUuid(ownerId, songUuid) {
  if (!songUuid) return null;
  const recs = await grist.listRecords("Releases", {
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
  await grist.deleteRecords(
    "Versions",
    versions.map((v) => v.id),
  );
  versions.forEach((v) => {
    safeUnlink(versionCachePath(v.fields.Uid));
    tracksOf(v).forEach((t) =>
      safeUnlink(versionTrackCachePath(v.fields.Uid, t)),
    );
  });
  await grist.deleteRecords("Releases", [rec.id]);
  invalidateRelease(uid);
  invalidateVersions(uid);
  return true;
}

// --- Release versions -------------------------------------------------------

const versionsCache = new Map();

async function getVersionRecords(releaseUid) {
  const hit = versionsCache.get(releaseUid);
  if (hit && hit.exp > Date.now()) return hit.recs;
  const recs = await grist.listRecords("Versions", {
    ReleaseUid: [releaseUid],
  });
  versionsCache.set(releaseUid, { recs, exp: Date.now() + SESSION_TTL_MS });
  return recs;
}

function invalidateVersions(releaseUid) {
  versionsCache.delete(releaseUid);
}

// A version carries a mixdown ({buffer,mime} — the single playable file) and,
// optionally, per-track stems ([{buffer,mime,name}]). Web uploads pass no
// stems; the pistes CLI import passes both.
export async function addVersion(
  releaseUid,
  { name, isDefault },
  mixdown: { buffer: Buffer; mime: string },
  tracks: { buffer: Buffer; mime: string; name?: string }[] = [],
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  const versionName = name || "Version";

  // The published version becomes a MORCEAU: morceaux/recorded/K7/<release>/<version>/.
  // The release is the album level and the version the title, because that is what they
  // are — one song, several mixes, each with its own audio and its own folder.
  const release = await getReleaseRecord(releaseUid);
  const master = await mediatek.pushVersion(
    mixdown.buffer,
    versionExt(mixdown.mime),
    {
      album: release?.fields.Title || "",
      title: versionName,
    },
  );

  // Stems live under the morceau, in `stems/`. A subfolder and not beside the master:
  // the scan takes the first audio file in the folder for the master and does not descend,
  // so a stem sitting next to it could be picked to play.
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

  await grist.addRecords("Versions", [
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

/** Take a published version out of the médiathèque: the whole morceau folder — master,
 *  stems, sidecar — since the folder IS the version. Never fatal, like a moment's clip. */
async function forgetVersionFolder(v) {
  if (!v?.fields.AudioPath) return;
  await mediatek.removeTree(dirOf(v.fields.AudioPath)).catch(() => {});
}

export async function setDefaultVersion(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const target = versions.find((v) => v.fields.Uid === versionUid);
  if (!target) return null;
  for (const v of versions) {
    const shouldBe = v.fields.Uid === versionUid;
    if (Boolean(v.fields.IsDefault) !== shouldBe) {
      await grist.patchRecord("Versions", v.id, { IsDefault: shouldBe });
    }
  }
  invalidateVersions(releaseUid);
  return true;
}

export async function renameVersion(releaseUid, versionUid, name) {
  const versions = await getVersionRecords(releaseUid);
  const v = versions.find((x) => x.fields.Uid === versionUid);
  if (!v) return null;
  await grist.patchRecord("Versions", v.id, { Name: String(name) });
  // The morceau's FOLDER keeps its old name, and its sidecar gets the new one — the same
  // rule the médiathèque's own mirror follows. A folder path is an entry id and a cache's
  // manifest key, so churning it would cost every machine a re-download of bytes that did
  // not change; the sidecar is where the displayed title lives anyway.
  if (v.fields.AudioPath) {
    const release = await getReleaseRecord(releaseUid);
    await mediatek
      .putFile(
        `${dirOf(v.fields.AudioPath)}/morceau.yaml`,
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
  await grist.deleteRecords("Versions", [v.id]);
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

export async function ensureVersionAudioCached(releaseUid, versionUid) {
  const versions = await getVersionRecords(releaseUid);
  const rec = versions.find((v) => v.fields.Uid === versionUid);
  if (!rec?.fields.AudioPath) return null;
  const mime = rec.fields.AudioMime || "audio/mpeg";
  const filePath = versionCachePath(versionUid);
  if (!fs.existsSync(filePath))
    await mediatek.download(String(rec.fields.AudioPath), filePath);
  return { filePath, mime };
}

function versionCachePath(uid) {
  return path.join(CACHE_DIR, `version-${uid}`);
}

/** The extension a version's mixdown is FILED under. `bin` is not a thing the médiathèque
 *  will take — it files by extension and would not see it as audio — and a version whose
 *  mime says nothing is already served as audio/mpeg, so mp3 is the honest guess. */
function versionExt(mime) {
  const ext = audioExtFor(mime);
  return ext === "bin" ? "mp3" : ext;
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

// Per-stem cache key — attachment id keeps files from colliding; the ext lets
// the browser sniff the type. Mirrors sheetCachePath.
function versionTrackCachePath(versionUid, entry) {
  // Keyed by the stem's rank in the version, which is unique within it — all a cache file
  // name needs.
  return path.join(
    CACHE_DIR,
    `version-${versionUid}-${entry.id}.${audioExtFor(entry.mime)}`,
  );
}

/** Make sure a version's stem is on disk, fetching it from the médiathèque.
 *  Returns { filePath, mime, name } or null. */
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
  const filePath = versionTrackCachePath(versionUid, entry);
  if (!fs.existsSync(filePath)) await mediatek.download(entry.path, filePath);
  return { filePath, mime: entry.mime, name: entry.name };
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
    createdAt: f.CreatedAt || "",
  };
}

async function getPageRecord(uid) {
  const recs = await grist.listRecords("Pages", { Uid: [uid] });
  return recs[0] || null;
}

export async function getPageOwner(uid) {
  const rec = await getPageRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function nametagExists(nametag, exceptUid?) {
  const recs = await grist.listRecords("Pages", { Nametag: [nametag] });
  return recs.some((r) => r.fields.Uid !== exceptUid);
}

export async function listPages(ownerId) {
  const recs = await grist.listRecords("Pages", { OwnerId: [ownerId] });
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
  await grist.addRecords("Pages", [
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
  await grist.patchRecord("Pages", rec.id, fields);
  return getPage(uid);
}

export async function deletePage(uid) {
  const rec = await getPageRecord(uid);
  if (!rec) return false;
  await grist.deleteRecords("Pages", [rec.id]);
  return true;
}

// --- Songs (songbook: lyrics / tablature / sheet, all free text) ------------

const songCache = new Map();

async function getSongRecord(uid) {
  const hit = songCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rec;
  const recs = await grist.listRecords("Songs", { Uid: [uid] });
  const rec = recs[0] || null;
  songCache.set(uid, { rec, exp: Date.now() + SESSION_TTL_MS });
  return rec;
}

function invalidateSong(uid) {
  songCache.delete(uid);
}

function sheetsOf(rec) {
  // SheetMeta is a JSON array of { id, name, mime }, one entry per attachment in
  // the SheetFiles column, in display order. Tolerate a missing/garbled value.
  try {
    const parsed = JSON.parse(rec.fields.SheetMeta || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function publicSong(rec) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    artist: f.Artist || "",
    title: f.Title || "",
    lyrics: f.Lyrics || "",
    tablature: f.Tablature || "",
    sheets: sheetsOf(rec).map((s) => ({
      id: s.id,
      name: s.name,
      mime: s.mime,
    })),
    favorite: Boolean(f.Favorite),
    createdAt: f.CreatedAt || "",
  };
}

export async function getSongOwner(uid) {
  const rec = await getSongRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function listSongs(ownerId) {
  const recs = await grist.listRecords("Songs", { OwnerId: [ownerId] });
  return recs.map(publicSong).sort(
    (a, b) =>
      // Favorites float to the top, then alphabetical by artist / title.
      Number(b.favorite) - Number(a.favorite) ||
      a.artist.localeCompare(b.artist) ||
      a.title.localeCompare(b.title),
  );
}

export async function getSong(uid) {
  const rec = await getSongRecord(uid);
  return rec ? publicSong(rec) : null;
}

export async function createSong(ownerId, { artist, title }) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await grist.addRecords("Songs", [
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
  if (patch.favorite !== undefined) fields.Favorite = Boolean(patch.favorite);
  await grist.patchRecord("Songs", rec.id, fields);
  invalidateSong(uid);
  return getSong(uid);
}

export async function deleteSong(uid) {
  const rec = await getSongRecord(uid);
  if (!rec) return false;
  await grist.deleteRecords("Songs", [rec.id]);
  invalidateSong(uid);
  return true;
}

// --- Song sheets (PDF / image attachments) ----------------------------------

// Persist the sheet file list back to Grist: the Attachments column keeps the
// raw ids (so the files show up in the Grist UI), and SheetMeta the parallel
// {id,name,mime} records that carry order + original filename + type.
async function writeSheets(rec, sheets) {
  await grist.patchRecord("Songs", rec.id, {
    SheetFiles: ["L", ...sheets.map((s) => Number(s.attachmentId))],
    SheetMeta: JSON.stringify(sheets),
  });
}

// Upload one or more files onto a song's sheet, appended after any existing
// ones. Each file is { buffer, mime, name }. Returns the updated public song.
export async function addSheetFiles(uid, files) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const existing = sheetsOf(rec);
  const added: {
    id: string;
    attachmentId: number;
    name: string;
    mime: string;
  }[] = [];
  for (const file of files) {
    const name = file.name || "sheet";
    const attachmentId = await grist.uploadAttachment(
      file.buffer,
      file.mime,
      name,
    );
    const entry = {
      id: String(attachmentId),
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
  safeUnlink(sheetCachePath(uid, gone));
  invalidateSong(uid);
  return getSong(uid);
}

/** Make sure a sheet file is on disk (fetching from Grist if needed) so it can
 *  be streamed. Returns { filePath, mime, name } or null. */
export async function ensureSheetFileCached(uid, fileId) {
  const rec = await getSongRecord(uid);
  if (!rec) return null;
  const entry = sheetsOf(rec).find((s) => s.id === fileId);
  if (!entry) return null;
  const filePath = sheetCachePath(uid, entry);
  if (!fs.existsSync(filePath)) {
    const buffer = await grist.downloadAttachment(Number(entry.attachmentId));
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

function sheetExtFor(mime) {
  if (mime === "application/pdf") return "pdf";
  const m = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.exec(mime || "");
  if (!m) return "bin";
  return m[1] === "svg+xml" ? "svg" : m[1] === "jpeg" ? "jpg" : m[1];
}

// Cache path for one sheet file — keyed by its attachment id so files never
// collide, with an extension that lets the OS / browser sniff the type.
function sheetCachePath(uid, entry) {
  return path.join(
    CACHE_DIR,
    `sheet-${uid}-${entry.attachmentId}.${sheetExtFor(entry.mime)}`,
  );
}

function safeUnlink(p) {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
