// stems.ts (routes) — ask for a song on this volume to be cut into stems. The job is THIS
// service's: the bytes are here, so the cut is driven from here and the results land here. The
// engine only lends its model and its CPU. See ../../docs/stems.md.

import { validate, wrap } from "@frediverse/http/route";
import type { EngineMount } from "@studio/engine-registry";
import { PathEscapesError } from "@studio/mediatek/layout";
import { INSTRUMENTAL } from "@studio/song-schema/stems";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { type Request, Router } from "express";
import { z } from "zod";
import { cutStems, heldFor } from "../stems/cut.ts";
import { jobIdFor, runningJob, startJob, stemsJob } from "../stems/jobs.ts";

/** pl8 has no express type augmentation, so the user is read this way, as in `routes/projects.ts`. */
function emailOf(req: Request): string | null {
  return (req as { user?: { email?: string } }).user?.email ?? null;
}

const body = z.object({
  /** Volume-relative, the string every other route here takes; `safePath` confines it. */
  song: z.string().min(1),
  /** Which registered engine lends its model — named by the caller, who is already on one. */
  engineId: z.string().min(1),
  /** Optional: absent, the engine's own `system stems` answers, one per machine. */
  chain: z.string().optional(),
  /** What to bring back: the four stems, or the record without its voice. */
  want: z.enum(["stems", INSTRUMENTAL]).optional(),
});

export function stemsRouter(engines: EngineMount): Router {
  const router: Router = Router();

  /** Start a cut, or say it is already done — the shapes the file service's `/stems` answered. */
  router.post(
    "/",
    validate(body),
    wrap(async (req, res) => {
      const { song, engineId, chain, want } = req.body as z.infer<typeof body>;
      const userEmail = emailOf(req) ?? "unknown";
      const asked = want ?? "stems";

      let done: boolean;
      try {
        // Asked of what THIS caller wants: an instrumental is not one of the four parts.
        done = heldFor(song, asked);
      } catch (e) {
        if (e instanceof PathEscapesError)
          return res.status(400).json({ error: e.message });
        throw e;
      }
      if (done) return res.json({ ready: true, job: null } as StemsReply);

      const engine = engines.registry.get(engineId);
      // A registry miss is a 409, not a 404: the engine existed when the browser picked it.
      if (!engine)
        return res.status(409).json({
          error: `no engine '${engineId}' is registered — is its machine running?`,
        });

      const id = jobIdFor(userEmail, song, `${chain ?? ""}\0${asked}`);
      const already = runningJob(id);
      if (already)
        return res.json({ ready: false, job: already } as StemsReply);

      const { progress, finish } = startJob(id, song);
      // Started and NOT awaited; the rejection is caught below, onto the job the poller reads.
      void cutStems({
        engine,
        userEmail,
        song,
        chain: chain ?? "",
        want: asked,
        onProgress: (j: SeparateJob) =>
          progress({
            phase: j.phase,
            percent: j.percent,
            lines: j.lines,
          }),
      })
        .then((done) =>
          finish({ files: done.files, phase: "done", percent: 100 }),
        )
        .catch((e: Error) =>
          finish({ failed: true, error: e.message, phase: "failed" }),
        );

      res.json({ ready: false, job: stemsJob(id) } as StemsReply);
    }),
  );

  /** Is this song ALREADY cut? A READ — the POST above starts a job, so it cannot answer this. */
  router.get(
    "/held",
    wrap((req, res) => {
      const song = String(req.query.song ?? "");
      if (!song) return res.status(400).json({ error: "song is required" });
      const asked = req.query.want === INSTRUMENTAL ? INSTRUMENTAL : "stems";
      try {
        // The same `ready` word the POST answers with, so one caller reads both the same way.
        res.json({ ready: heldFor(song, asked), job: null } as StemsReply);
      } catch (e) {
        if (e instanceof PathEscapesError)
          return res.status(400).json({ error: e.message });
        throw e;
      }
    }),
  );

  /** How a cut is getting on. A 404 means "look at the disk", the contract `/separate/:id` had. */
  router.get(
    "/:id",
    wrap((req, res) => {
      const job = stemsJob(req.params.id);
      if (!job)
        return res.status(404).json({ error: "unknown separation job" });
      res.json(job);
    }),
  );

  return router;
}
