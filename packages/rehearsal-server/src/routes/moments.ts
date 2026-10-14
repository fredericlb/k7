// Moments: standalone views over validated annotations, addressed by their own
// id and scoped by owner, so they keep working after their session is deleted.

import { streamFile, sub, validate, wrap } from "@frediverse/http";
import { Router } from "express";
import { z } from "zod";
import * as store from "../store.ts";

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

momentsRouter.get(
  "/:mid",
  wrap(async (req, res) => {
    const moment = await store.getMoment(sub(req), req.params.mid);
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
    streamFile(req, res, info.filePath, info.mime);
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
