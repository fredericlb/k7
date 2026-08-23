// stems.ts (routes) — ask for a song on this volume to be cut into stems. The job is THIS
// service's: the bytes are here, so the cut is driven from here and the results land here. The
// engine only lends its model and its CPU. See ../../docs/stems.md.

import { validate, wrap } from "@frediverse/http/route";
import type { EngineMount } from "@studio/engine-registry";
import { PathEscapesError } from "@studio/mediatek/layout";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { type Request, Router } from "express";
import { z } from "zod";
import { CutError, cutStems, heldStems } from "../stems/cut.ts";
import { jobIdFor, runningJob, startJob, stemsJob } from "../stems/jobs.ts";

/** pl8 has no express type augmentation of its own; every route here reads the user this way —
 *  the same shape `routes/projects.ts` states, and for the same reason. */
function emailOf(req: Request): string | null {
  return (req as { user?: { email?: string } }).user?.email ?? null;
}

const body = z.object({
  /** Volume-relative — `songs/<artiste>/<album>/<titre>/original.mp3`, the string every other
   *  route here takes. Confined by `safePath` inside `cutStems`. */
  song: z.string().min(1),
  /** Which registered engine lends its model. Named by the caller because it is the one this
   *  browser is already on — this service has no opinion about which machine is yours. */
  engineId: z.string().min(1),
  /** Optional: the engine's own `system stems` answer is used when this is absent, which is
   *  where that choice has always lived (one answer per machine, not per request). */
  chain: z.string().optional(),
});

export function stemsRouter(engines: EngineMount): Router {
  const router: Router = Router();

  /**
   * Start a cut, or say it is already done.
   *
   * The SAME two shapes the file service's `/stems` answered — `StemsReply` here, `SeparateJob`
   * from the poll below — so the desk changed only where it points. That is deliberate: the work
   * moved between services, and a browser watching a separation should not be able to tell.
   *
   * Already cut is not an error and not work: `heldStems` asks the FOLDER, and the folder is the
   * truth about what has been produced.
   */
  router.post(
    "/",
    validate(body),
    wrap(async (req, res) => {
      const { song, engineId, chain } = req.body as z.infer<typeof body>;
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

      const engine = engines.registry.get(engineId);
      // A registry miss is a 409 rather than a 404: the engine existed when the browser picked
      // it, and what to do about it — bring the machine back up — is not "this URL is wrong".
      if (!engine)
        return res.status(409).json({
          error: `no engine '${engineId}' is registered — is its machine running?`,
        });

      const id = jobIdFor(userEmail, song, chain ?? "");
      const already = runningJob(id);
      if (already)
        return res.json({ ready: false, job: already } as StemsReply);

      const { progress, finish } = startJob(id, song);
      /**
       * Started and NOT awaited — the whole point of a job.
       *
       * The rejection is handled inside, so this is not a floating promise: `cutStems` throws
       * only `CutError`s carrying a sentence, and the sentence belongs on the job where the
       * poller will read it rather than in this service's log where nobody is looking.
       */
      void cutStems({
        engine,
        userEmail,
        song,
        chain: chain ?? "",
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

  /** How a cut is getting on. 404s once this service has forgotten a finished one, which the
   *  caller reads as "look at the disk" rather than as a failure — the same contract
   *  `/separate/:id` had, and the desk already handles it. */
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
