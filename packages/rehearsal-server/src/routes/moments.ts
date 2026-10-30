// Moments: spans of a recording, a session's or any capture of the zone, addressed by their
// own id and scoped by owner, so they keep working after their recording is gone (../../docs/moments.md).

import { sub, validate, wrap } from "@frediverse/http";
import { isCapturePath } from "@studio/mediatek/recordingName";
import { type Request, type RequestHandler, Router } from "express";
import { z } from "zod";
import { streamAudio } from "../serve.ts";
import * as store from "../store.ts";

const momentCreate = z.object({
  recordingPath: z.string().min(1),
  startSec: z.coerce.number(),
  endSec: z.coerce.number(),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
const momentPatch = z.object({
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

export const momentsRouter = Router();

// A moment shared from a machine is edited there and shared again; here it is read, or deleted.
momentsRouter.use("/:mid", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.method === "DELETE" && req.path === "/") return next();
  store
    .momentSharedFrom(sub(req), req.params.mid)
    .then((from) =>
      from
        ? res.status(403).json({
            error: `shared from ${from}: edit it there and share it again`,
          })
        : next(),
    )
    .catch(next);
});

momentsRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listMoments(sub(req)));
  }),
);

momentsRouter.post(
  "/",
  validate(momentCreate),
  wrap(async (req, res) => {
    const { recordingPath, ...span } = req.body as z.infer<typeof momentCreate>;
    const moment = await store.addMoment(sub(req), recordingPath, span);
    if (!moment) return res.status(400).json({ error: "not a recording" });
    res.status(201).json(moment);
  }),
);

// Pins on a recording's timeline, owned like its moments.
const recordingMarkerCreate = markerCreate.extend({
  recordingPath: z.string().min(1),
});

momentsRouter.post(
  "/recording/markers",
  validate(recordingMarkerCreate),
  wrap(async (req, res) => {
    const { recordingPath, ...pin } = req.body as z.infer<
      typeof recordingMarkerCreate
    >;
    const marker = store.addRecordingMarker(sub(req), recordingPath, pin);
    if (!marker) return res.status(400).json({ error: "not a recording" });
    res.status(201).json(marker);
  }),
);

momentsRouter.put(
  "/recording/markers/:markerId",
  validate(markerPatch),
  wrap(async (req, res) => {
    const marker = store.updateRecordingMarker(
      sub(req),
      req.params.markerId,
      req.body,
    );
    if (!marker) return res.status(404).json({ error: "not found" });
    res.json(marker);
  }),
);

momentsRouter.delete(
  "/recording/markers/:markerId",
  wrap(async (req, res) => {
    const ok = store.deleteRecordingMarker(sub(req), req.params.markerId);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

// A recording's own page: its start, the session that saved it if one did, its moments and markers.
momentsRouter.get(
  "/recording",
  wrap(async (req, res) => {
    const found = store.recordingMoments(
      sub(req),
      String(req.query.path ?? ""),
    );
    if (!found) return res.status(400).json({ error: "not a recording" });
    res.json(found);
  }),
);

momentsRouter.get(
  "/:mid",
  wrap(async (req, res) => {
    const moment = await store.getMoment(sub(req), req.params.mid);
    if (!moment) return res.status(404).json({ error: "not found" });
    res.json(moment);
  }),
);

momentsRouter.put(
  "/:mid",
  validate(momentPatch),
  wrap(async (req, res) => {
    const moment = await store.updateMoment(sub(req), req.params.mid, req.body);
    if (!moment) return res.status(404).json({ error: "not found" });
    res.json(moment);
  }),
);

// Cut the clip again, for a moment whose automatic cut could not run.
momentsRouter.post(
  "/:mid/validate",
  wrap(async (req, res) => {
    const moment = await store.validateMoment(sub(req), req.params.mid);
    if (!moment) return res.status(404).json({ error: "not found" });
    res.json(moment);
  }),
);

momentsRouter.delete(
  "/:mid",
  wrap(async (req, res) => {
    const ok = await store.deleteMoment(sub(req), req.params.mid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

momentsRouter.get(
  "/:mid/clip",
  wrap(async (req, res) => {
    const info = await store.ensureMomentClipCached(sub(req), req.params.mid);
    if (!info) return res.status(404).json({ error: "no clip" });
    streamAudio(req, res, info.filePath, info.mime);
  }),
);

// Moment markers — pins on the moment's own clip timeline.
momentsRouter.post(
  "/:mid/markers",
  validate(markerCreate),
  wrap(async (req, res) => {
    const moment = await store.getMoment(sub(req), req.params.mid);
    if (!moment) return res.status(404).json({ error: "not found" });
    const marker = await store.addMomentMarker(
      sub(req),
      req.params.mid,
      req.body,
    );
    res.status(201).json(marker);
  }),
);

momentsRouter.put(
  "/:mid/markers/:markerId",
  validate(markerPatch),
  wrap(async (req, res) => {
    const marker = await store.updateMomentMarker(
      sub(req),
      req.params.mid,
      req.params.markerId,
      req.body,
    );
    if (!marker) return res.status(404).json({ error: "not found" });
    res.json(marker);
  }),
);

momentsRouter.delete(
  "/:mid/markers/:markerId",
  wrap(async (req, res) => {
    const ok = await store.deleteMomentMarker(
      sub(req),
      req.params.mid,
      req.params.markerId,
    );
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

/** Delete a recording: its owner's take, or any capture for whoever may manage the library — ../../docs/moments.md. */
export const deleteRecordingRoute = (
  mayManage: (req: Request) => boolean,
): RequestHandler =>
  wrap(async (req, res) => {
    const path = String(req.query.path ?? "");
    if (!isCapturePath(path))
      return res.status(400).json({ error: "not a recording" });
    const own = store.recordingMoments(sub(req), path)?.sessionId;
    if (!own && !mayManage(req))
      return res.status(403).json({
        error: "only its owner or an admin may delete a recording",
      });
    await store.deleteRecording(path);
    res.status(204).end();
  });
