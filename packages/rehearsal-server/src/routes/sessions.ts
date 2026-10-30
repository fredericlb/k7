/* Recording sessions: the take a session files, its loudness envelope and gain.
   Its moments and markers are the recording's, under /moments.
*/

import { ownerGuard, sub, wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import type { Envelope } from "@studio/rehearsal-shared";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { audioExtOf, isAudioMime, streamAudio } from "../serve.ts";
import * as store from "../store.ts";

export const sessionsRouter = Router();

// A take arrives on DISK, not in memory: an hours-long recording over a slow uplink must not sit whole in RAM (../../docs/audit.md).
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

async function receiveTake(req: Request, res: Response) {
  if (!req.file) return res.status(400).json({ error: "missing audio file" });
  if (!req.file.size)
    return res
      .status(400)
      .json({ error: "empty recording — nothing captured" });
  if (!isAudioMime(req.file.mimetype))
    return res
      .status(400)
      .json({ error: `not an audio file: ${req.file.mimetype}` });

  let envelope: Envelope;
  try {
    envelope = envelopeShape.parse(JSON.parse(req.body.envelope)) as Envelope;
  } catch {
    return res.status(400).json({ error: "invalid envelope" });
  }

  const mime = req.file.mimetype;
  const ext = audioExtOf(mime) ?? "webm";
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

  res.json(updated);
}

sessionsRouter.get(
  "/:id/recording",
  wrap(async (req, res) => {
    const info = await store.ensureRecordingCached(req.params.id);
    if (!info) return res.status(404).json({ error: "no recording" });
    streamAudio(req, res, info.filePath, info.mime);
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
