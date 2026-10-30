// moments.ts — a moment (a `Comments` row): a span of a recording, a session's or any other capture's,
// standing alone with its own clip, envelope and markers once that recording is gone.
// The clip is cut and re-encoded off the request thread (../../docs/audio.md, ../../docs/moments.md).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isCapturePath } from "@studio/mediatek/recordingName";
import type { Envelope, Marker } from "@studio/rehearsal-shared";
import { cachedFile, once } from "../cache.ts";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import { serialized } from "../lock.ts";
import * as mediatek from "../mediatek.ts";
import type { FieldsOf } from "../schema.ts";
import { SAFE_ID } from "../sqlite.ts";
import { cutClip } from "../transcode.ts";
import {
  type CachedFile,
  type Capture,
  captureOf,
  sessionsByPath,
} from "./captures.ts";
import {
  CACHE_DIR,
  fetching,
  mapComment,
  mapMarker,
  normalizeTags,
  rowIn,
  safeUnlink,
} from "./helpers.ts";

type CommentRow = Row<"Comments">;

// --- Moments on a recording ----------------------------------------------

type MomentFields = {
  startSec: number;
  endSec: number;
  text?: string;
  tags?: unknown;
};

/** A moment cut from the capture at `recordingPath`; null for a path that is no capture (../../docs/moments.md). */
export async function addMoment(
  ownerId: string,
  recordingPath: string,
  { startSec, endSec, text, tags }: MomentFields,
) {
  if (!isCapturePath(recordingPath)) return null;
  const ann = {
    startSec: Number(startSec),
    endSec: Number(endSec),
    text: String(text ?? ""),
    tags: normalizeTags(tags),
    createdAt: new Date().toISOString(),
  };
  const started = captureOf(ownerId, recordingPath).startedAt;
  const [{ id }] = db.addRecords("Comments", [
    {
      RecordingPath: recordingPath,
      RecordedAt: started ? started.toISOString() : "",
      OwnerId: ownerId,
      StartSec: ann.startSec,
      EndSec: ann.endSec,
      Text: ann.text,
      Tags: ann.tags.join(","),
      CreatedAt: ann.createdAt,
    },
  ]);
  // Extract now so a saved moment plays on its own; best-effort, a failure leaves it be.
  const validated = await extractMomentClip(String(id)).catch((e: Error) => {
    console.error("moment auto-extract failed:", e.message);
    return false;
  });
  return { id: String(id), recordingPath, ...ann, validated };
}

export async function updateMoment(
  ownerId: string,
  momentId: string,
  patch: { startSec?: number; endSec?: number; text?: string; tags?: unknown },
) {
  const before = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!before) return null;

  const fields: Partial<FieldsOf<"Comments">> = {};
  if (patch.startSec !== undefined) fields.StartSec = Number(patch.startSec);
  if (patch.endSec !== undefined) fields.EndSec = Number(patch.endSec);
  if (patch.text !== undefined) fields.Text = String(patch.text);
  if (patch.tags !== undefined)
    fields.Tags = normalizeTags(patch.tags).join(",");
  db.patchRecord("Comments", momentId, fields);

  // A moved timespan makes the extracted clip wrong — drop it and re-extract.
  const rangeChanged =
    (fields.StartSec !== undefined &&
      fields.StartSec !== Number(before.fields.StartSec)) ||
    (fields.EndSec !== undefined &&
      fields.EndSec !== Number(before.fields.EndSec));
  if (rangeChanged) {
    safeUnlink(clipCachePath(momentId));
    await extractMomentClip(momentId).catch((e: Error) =>
      console.error("moment auto re-extract failed:", e.message),
    );
  }

  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  return rec ? mapComment(rec) : null;
}

/** The capture at `recordingPath` as its page reads it: its start, the session that saved it, its moments. */
export function recordingMoments(ownerId: string, recordingPath: string) {
  if (!isCapturePath(recordingPath)) return null;
  const capture = captureOf(ownerId, recordingPath);
  const moments = db
    .listRecords("Comments", {
      RecordingPath: [recordingPath],
      OwnerId: [ownerId],
    })
    .map(mapComment)
    .sort((a, b) => a.startSec - b.startSec);
  return {
    path: recordingPath,
    recordedAt: capture.startedAt?.toISOString() ?? null,
    sessionId: capture.sessionUid,
    moments,
  };
}

// --- Standalone moments -----------------------------------------------------

interface OwnerContext {
  sessions: ReturnType<typeof sessionsByPath>;
  /** Every capture the zone lists; null when the library could not say, which reads as all there. */
  captures: Set<string> | null;
}

async function ownerContext(ownerId: string): Promise<OwnerContext> {
  const captures = await mediatek.capturePaths().catch(() => null);
  return { sessions: sessionsByPath(ownerId), captures };
}

// A moment has its own owner-addressable view, whichever recording it came from.
function publicMoment(rec: CommentRow, ctx: OwnerContext) {
  const recordingPath = rec.fields.RecordingPath;
  const session = recordingPath ? ctx.sessions.get(recordingPath) : undefined;
  return {
    ...mapComment(rec),
    recordedAt: rec.fields.RecordedAt || null,
    sessionId: session?.uid ?? null,
    recordingAvailable:
      !!recordingPath &&
      (!!session || (ctx.captures?.has(recordingPath) ?? true)),
  };
}

export async function listMoments(ownerId: string) {
  const recs = db.listRecords("Comments", { OwnerId: [ownerId] });
  const ctx = await ownerContext(ownerId);
  return recs
    .map((r) => publicMoment(r, ctx))
    .sort(
      (a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        a.startSec - b.startSec,
    );
}

/** A moment by its own id, owner-scoped, with the envelope and markers its player needs. */
export async function getMoment(ownerId: string, momentId: string) {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!rec) return null;
  const base = publicMoment(rec, await ownerContext(ownerId));

  // The stored slice, or one cut live from the recording when the moment carries none.
  let envelope: Envelope | null = null;
  if (rec.fields.Envelope) {
    try {
      envelope = JSON.parse(String(rec.fields.Envelope));
    } catch {
      envelope = null;
    }
  }
  if (!envelope && base.recordingAvailable && rec.fields.RecordingPath) {
    const full = await captureOf(ownerId, rec.fields.RecordingPath).envelope();
    if (full) envelope = sliceEnvelope(full, base.startSec, base.endSec);
  }

  const markers = await listMomentMarkers(ownerId, momentId);
  return { ...base, envelope, markers };
}

export async function deleteMoment(
  ownerId: string,
  momentId: string,
): Promise<boolean> {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!rec) return false;
  await forgetClip(rec);
  db.deleteRecords("Comments", [rec.id]);
  safeUnlink(clipCachePath(rec.id));
  return true;
}

/** A moment's clip out of the zone, before the row that holds its path; never fatal. */
async function forgetClip(rec: CommentRow): Promise<void> {
  if (!rec?.fields.ClipPath) return;
  await mediatek.remove(rec.fields.ClipPath).catch(() => {});
}

/** Ensure a moment's clip is cached, looked up by owner + moment id alone. */
export async function ensureMomentClipCached(
  ownerId: string,
  momentId: string,
): Promise<CachedFile | null> {
  // The owner is checked BEFORE the cache: a cached file must not answer for someone else's moment.
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  return rec ? clipOnDisk(rec) : null;
}

/** A row's clip, fetched into the cache unless it is already there; null when it has none. */
async function clipOnDisk(rec: CommentRow): Promise<CachedFile | null> {
  const remote = rec.fields.ClipPath;
  if (!remote) return null;
  const filePath = clipCachePath(rec.id);
  if (cachedFile(filePath)) return { filePath, mime: "audio/webm" };
  await once(fetching, filePath, () =>
    mediatek.download(String(remote), filePath),
  );
  return { filePath, mime: "audio/webm" };
}

// --- Moment markers ---------------------------------------------------------

// Pins on a moment's clip timeline: the shared Markers table, keyed by MomentId not SessionUid.
async function listMomentMarkers(
  ownerId: string,
  momentId: string,
): Promise<Marker[]> {
  const recs = await db.listRecords("Markers", {
    MomentId: [String(momentId)],
  });
  return recs
    .filter((r) => r.fields.OwnerId === ownerId)
    .map(mapMarker)
    .sort((a, b) => a.atSec - b.atSec);
}

export async function addMomentMarker(
  ownerId: string,
  momentId: string,
  { atSec, comment }: { atSec?: number; comment?: string },
): Promise<Marker> {
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

export async function updateMomentMarker(
  ownerId: string,
  momentId: string,
  markerId: string,
  patch: { atSec?: number; comment?: string },
): Promise<Marker | null> {
  const rec = rowIn("Markers", markerId, {
    MomentId: String(momentId),
    OwnerId: ownerId,
  });
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Markers">> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  await db.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export async function deleteMomentMarker(
  ownerId: string,
  momentId: string,
  markerId: string,
): Promise<boolean> {
  const rec = rowIn("Markers", markerId, {
    MomentId: String(momentId),
    OwnerId: ownerId,
  });
  if (!rec) return false;
  await db.deleteRecords("Markers", [rec.id]);
  return true;
}

// --- Moment validation (extract a standalone clip) --------------------------

// One cut per moment at a time, each reading the row afresh: two quick drags end on the clip of the LAST span — ../../docs/audio.md.
function extractMomentClip(momentId: string): Promise<boolean> {
  return serialized(`clip:${momentId}`, async () => {
    const rec = db.getRecord("Comments", momentId);
    if (!rec?.fields.RecordingPath) return false;
    return extractMomentClipUnlocked(rec);
  });
}

// A moment's timespan cut out of its recording into its own clip — ../../docs/audio.md.
async function extractMomentClipUnlocked(rec: CommentRow): Promise<boolean> {
  const capture = captureOf(rec.fields.OwnerId, rec.fields.RecordingPath);
  const info = await capture.file();
  if (!info) return false;

  const start = Number(rec.fields.StartSec);
  const end = Number(rec.fields.EndSec);
  const clip = await extractClip(info.filePath, start, end);
  try {
    await publishMomentClip(capture, rec, clip, start, end);
  } catch (e) {
    safeUnlink(clip);
    throw e;
  }
  return true;
}

// The cut file pushed from disk, then RENAMED into the cache: never whole in memory, never half-written where it is served.
async function publishMomentClip(
  capture: Capture,
  rec: CommentRow,
  clip: string,
  start: number,
  end: number,
): Promise<void> {
  // The moment's own envelope, so its view still draws a waveform once the recording is gone.
  const full = await capture.envelope();
  const sliced = full ? sliceEnvelope(full, start, end) : null;

  // Re-extracting replaces: the span or the name may have moved, so the old name is a lie.
  const previous = rec.fields.ClipPath;
  const clipPath = await mediatek.pushMoment(
    await fs.openAsBlob(clip),
    "webm",
    {
      at: momentPlayedAt(capture.startedAt, start),
      durationSec: end - start,
      label: rec.fields.Text,
    },
  );
  if (previous && previous !== clipPath) await mediatek.remove(previous);

  db.patchRecord("Comments", rec.id, {
    Validated: true,
    ClipPath: clipPath,
    Envelope: sliced ? JSON.stringify(sliced) : "",
  });
  // A download of the previous clip still in flight would land over this one once it finished.
  await fetching.get(clipCachePath(rec.id))?.catch(() => {});
  fs.renameSync(clip, clipCachePath(rec.id));
}

/** When a moment was PLAYED: the recording's start plus its offset, not the annotation's CreatedAt. */
function momentPlayedAt(
  started: Date | null,
  startSec: number,
): Date | undefined {
  if (!started) return undefined;
  return new Date(started.getTime() + Math.max(0, startSec) * 1000);
}

// The recording's envelope over [startSec, endSec], re-based to a clip timeline starting at 0.
function sliceEnvelope(
  env: Envelope,
  startSec: number,
  endSec: number,
): Envelope {
  const per = (env.intervalMs || 200) / 1000;
  const i0 = Math.max(0, Math.floor(startSec / per));
  const i1 = Math.min(env.samples.length, Math.ceil(endSec / per));
  return {
    intervalMs: env.intervalMs || 200,
    samples: env.samples.slice(i0, i1),
  };
}

// Manual re-extract, for a moment whose automatic one could not run.
export async function validateMoment(ownerId: string, momentId: string) {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!rec) return null;
  const ok = await extractMomentClip(rec.id);
  if (!ok) throw new Error("this moment's recording is gone");
  return mapComment({ id: rec.id, fields: { ...rec.fields, Validated: true } });
}

/** The machine an owner's moment was shared from, "" for one of this server's own — ../../docs/momentShare.md. */
export async function momentSharedFrom(
  ownerId: string,
  momentId: string,
): Promise<string> {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  return rec ? String(rec.fields.SharedFrom || "") : "";
}

/** Forget a moment's cached clip, for a moment whose clip was just replaced. */
export function dropClipCache(momentId: string): void {
  safeUnlink(clipCachePath(momentId));
}

function clipCachePath(momentId: string): string {
  // The id names a file: one plain segment, or nothing reaches the disk.
  if (!SAFE_ID.test(String(momentId)))
    throw new Error(`bad moment id ${momentId}`);
  return path.join(CACHE_DIR, `clip-${momentId}.webm`);
}

// A re-encode of minutes of audio is seconds of CPU at most: past this, the worker is stuck and is killed.
const CLIP_TIMEOUT_MS = 10 * 60_000;

// Cut [start, end] out of a source file into a temporary webm/opus FILE; the caller owns the path it resolves.
async function extractClip(
  srcPath: string,
  start: number,
  end: number,
): Promise<string> {
  const duration = Math.max(0.05, end - start);
  const outPath = path.join(CACHE_DIR, `tmp-${randomUUID()}.webm`);
  try {
    await cutClip(srcPath, start, duration, outPath, {
      timeoutMs: CLIP_TIMEOUT_MS,
    });
  } catch (e) {
    safeUnlink(outPath);
    throw e;
  }
  return outPath;
}
