// stems.ts (routes) — ask for a song on this volume to be cut into stems. The job is THIS
// service's from end to end: the bytes are here, the model is here, and the stems land here.
// No engine is named and none is needed. See ../../docs/stems.md.

import { validate, wrap } from "@frediverse/http/route";
import { PathEscapesError } from "@studio/mediatek/layout";
import { stemsComplete } from "@studio/song-schema/stems";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { type Request, Router } from "express";
import { z } from "zod";
import { cutStems, heldStems } from "../stems/cut.ts";
import { jobIdFor, runningJob, startJob, stemsJob } from "../stems/jobs.ts";
import { NoModelError, stemsModel } from "../stems/model.ts";
import { enqueue, withWait } from "../stems/queue.ts";

/** pl8 has no express type augmentation, so the user is read this way, as in `routes/projects.ts`. */
function emailOf(req: Request): string | null {
  return (req as { user?: { email?: string } }).user?.email ?? null;
}

const body = z.object({
  /** Volume-relative, the string every other route here takes; `safePath` confines it. */
  song: z.string().min(1),
});

export function stemsRouter(): Router {
  const router: Router = Router();

  /** Start a cut, or say it is already done — the shapes the file service's `/stems` answered. */
  router.post(
    "/",
    validate(body),
    wrap(async (req, res) => {
      const { song } = req.body as z.infer<typeof body>;
      const userEmail = emailOf(req) ?? "unknown";

      let held: string[];
      try {
        held = heldStems(song);
      } catch (e) {
        if (e instanceof PathEscapesError)
          return res.status(400).json({ error: e.message });
        throw e;
      }
      if (held.length)
        return res.json({ ready: true, job: null } as StemsReply);

      // Up front, so a server with no model says so NOW rather than queueing a cut that cannot
      // run — and says it once, instead of onto a job the caller has to poll to discover.
      try {
        stemsModel();
      } catch (e) {
        if (e instanceof NoModelError)
          return res.status(503).json({ error: e.message });
        throw e;
      }

      const id = jobIdFor(userEmail, song);
      const already = runningJob(id);
      if (already)
        return res.json({ ready: false, job: withWait(already) } as StemsReply);

      const { progress, finish } = startJob(id, song);
      // Queued, not started: one cut at a time on a shared host — ../stems/queue.ts.
      enqueue(id, () =>
        cutStems({
          userEmail,
          song,
          onProgress: (j: SeparateJob) =>
            progress({ phase: j.phase, percent: j.percent, lines: j.lines }),
        })
          .then((done) =>
            finish({ files: done.files, phase: "done", percent: 100 }),
          )
          .catch((e: Error) =>
            finish({ failed: true, error: e.message, phase: "failed" }),
          ),
      );

      const job = stemsJob(id);
      res.json({
        ready: false,
        job: job && withWait(job),
      } as StemsReply);
    }),
  );

  /** Is this song ALREADY cut? A READ — the POST above starts a job, so it cannot answer this. */
  router.get(
    "/held",
    wrap((req, res) => {
      const song = String(req.query.song ?? "");
      if (!song) return res.status(400).json({ error: "song is required" });
      try {
        const held = heldStems(song);
        // The same `ready` word the POST answers with, so one caller reads both the same way.
        res.json({ ready: stemsComplete(held), job: null } as StemsReply);
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
      res.json(withWait(job));
    }),
  );

  return router;
}
