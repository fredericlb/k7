/* Recording sessions and everything hung off them: the recording blob, its
   loudness envelope, detected events, annotations, markers and moment clips.
*/

import { ownerGuard, streamFile, sub, validate, wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import type { Envelope } from "@k7/shared";
import { Router } from "express";
import { z } from "zod";
import { detectEvents } from "../detect.ts";
import * as store from "../store.ts";

const annotationCreate = z.object({
  startSec: z.coerce.number(),
  endSec: z.coerce.number(),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
const annotationPatch = z.object({
  startSec: z.coerce.number().optional(),
  endSec: z.coerce.number().optional(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
const markerCreate = z.object({
  atSec: z.coerce.number().default(0),
  comment: z.string().default(""),
});
const markerPatch = z.object({
  atSec: z.coerce.number().optional(),
  comment: z.string().optional(),
});

export const sessionsRouter = Router();

// A take arrives on DISK, not in memory: an hours-long recording over a slow uplink must not sit whole in RAM (docs/audit.md).
const takeUpload = diskUpload(store.UPLOAD_DIR);

// What a recording's envelope must be before anything is stored against it.
const envelopeShape = z.object({
  intervalMs: z.number().positive(),
  samples: z.array(z.number()),
});

// Any :id route must resolve to a session owned by the current user.
sessionsRouter.param("id", ownerGuard(store.getOwner));

sessionsRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listSessions(sub(req)));
  }),
);

sessionsRouter.post(
  "/",
  wrap(async (req, res) => {
    res.status(201).json(await store.createSession(sub(req)));
  }),
);

sessionsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const session = await store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "not found" });
    res.json(session);
  }),
);

sessionsRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    const ok = await store.deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

// --- Recording upload / download ------------------------------------------

sessionsRouter.post(
  "/:id/recording",
  takeUpload.single("audio"),
  wrap(async (req, res) => {
    try {
      await receiveTake(req, res);
    } finally {
      // The store MOVES a take it keeps; anything still here was refused or failed.
      if (req.file) store.discardUploads([req.file]);
    }
  }),
);

async function receiveTake(req, res) {
  if (!req.file) return res.status(400).json({ error: "missing audio file" });
  if (!req.file.size)
    return res
      .status(400)
      .json({ error: "empty recording — nothing captured" });

  let envelope: Envelope;
  try {
    envelope = envelopeShape.parse(JSON.parse(req.body.envelope)) as Envelope;
  } catch {
    return res.status(400).json({ error: "invalid envelope" });
  }

  const mime = req.file.mimetype || "audio/webm";
  const ext = mime.includes("ogg")
    ? "ogg"
    : mime.includes("mp4")
      ? "mp4"
      : "webm";
  const duration = Number(req.body.duration) || 0;
  const gain = Number(req.body.gain) || 1;
  const append = req.body.append === "true";

  const save = append ? store.appendRecording : store.saveRecording;
  const updated = await save(
    req.params.id,
    req.file.path,
    mime,
    ext,
    duration,
    envelope,
    gain,
  );

  // Re-detect over the STORED envelope, which is the whole timeline after an append.
  const stored = (await store.getEnvelope(req.params.id)) || envelope;
  const { events } = detectEvents(stored, {});
  await store.replaceHighlights(req.params.id, events);

  res.json(updated);
}

sessionsRouter.get(
  "/:id/recording",
  wrap(async (req, res) => {
    const info = await store.ensureRecordingCached(req.params.id);
    if (!info) return res.status(404).json({ error: "no recording" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);

sessionsRouter.get(
  "/:id/envelope",
  wrap(async (req, res) => {
    const env = await store.getEnvelope(req.params.id);
    if (!env) return res.status(404).json({ error: "no envelope" });
    res.json(env);
  }),
);

// --- Event detection ------------------------------------------------------

sessionsRouter.get(
  "/:id/events",
  wrap(async (req, res) => {
    const env = await store.getEnvelope(req.params.id);
    if (!env) return res.status(404).json({ error: "no envelope" });
    res.json(
      detectEvents(env, {
        threshold: req.query.threshold as string | undefined,
        minSilenceSec: req.query.minSilenceSec as string | undefined,
      }),
    );
  }),
);

// --- Annotations ----------------------------------------------------------

sessionsRouter.post(
  "/:id/annotations",
  validate(annotationCreate),
  wrap(async (req, res) => {
    const ann = await store.addAnnotation(req.params.id, req.body, sub(req));
    if (!ann) return res.status(404).json({ error: "not found" });
    res.status(201).json(ann);
  }),
);

sessionsRouter.put(
  "/:id/annotations/:annId",
  validate(annotationPatch),
  wrap(async (req, res) => {
    const ann = await store.updateAnnotation(
      req.params.id,
      req.params.annId,
      req.body,
    );
    if (!ann) return res.status(404).json({ error: "not found" });
    res.json(ann);
  }),
);

sessionsRouter.delete(
  "/:id/annotations/:annId",
  wrap(async (req, res) => {
    const ok = await store.deleteAnnotation(req.params.id, req.params.annId);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

// --- Markers (single-timestamp pins) --------------------------------------

sessionsRouter.post(
  "/:id/markers",
  validate(markerCreate),
  wrap(async (req, res) => {
    const marker = await store.addMarker(req.params.id, req.body, sub(req));
    if (!marker) return res.status(404).json({ error: "not found" });
    res.status(201).json(marker);
  }),
);

sessionsRouter.put(
  "/:id/markers/:markerId",
  validate(markerPatch),
  wrap(async (req, res) => {
    const marker = await store.updateMarker(
      req.params.id,
      req.params.markerId,
      req.body,
    );
    if (!marker) return res.status(404).json({ error: "not found" });
    res.json(marker);
  }),
);

sessionsRouter.delete(
  "/:id/markers/:markerId",
  wrap(async (req, res) => {
    const ok = await store.deleteMarker(req.params.id, req.params.markerId);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

// --- Moment validation / clip ---------------------------------------------

sessionsRouter.post(
  "/:id/annotations/:annId/validate",
  wrap(async (req, res) => {
    const moment = await store.validateMoment(req.params.id, req.params.annId);
    if (!moment) return res.status(404).json({ error: "not found" });
    res.json(moment);
  }),
);

sessionsRouter.get(
  "/:id/annotations/:annId/clip",
  wrap(async (req, res) => {
    const info = await store.ensureClipCached(req.params.id, req.params.annId);
    if (!info) return res.status(404).json({ error: "no clip" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);
