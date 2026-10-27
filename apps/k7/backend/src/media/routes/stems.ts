// stems.ts (routes) — ask for a song on this volume to be cut into stems. The job is THIS
// service's: the bytes are here, so the cut is driven from here and the results land here. The
// engine's machine lends its model and its CPU, over the tunnel. See ../../../docs/media/stems.md.

import { validate, wrap } from "@frediverse/http/route";
import { claimHolder, type EngineMount } from "@studio/engine-registry";
import { PathEscapesError } from "@studio/mediatek/layout";
import { INSTRUMENTAL } from "@studio/song-schema/stems";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { Router } from "express";
import { z } from "zod";
import { emailOf } from "../../who.ts";
import { type CutDeps, cutStems, heldFor } from "../stems/cut.ts";
import { bestCutter, mayCut } from "../stems/engine.ts";
import { jobIdFor, runningJob, startJob, stemsJob } from "../stems/jobs.ts";

const body = z.object({
  /** Volume-relative, the string every other route here takes; `safePath` confines it. */
  song: z.string().min(1),
  /** Which registered engine lends its model; absent, the best-rated one the caller may cut on. */
  engineId: z.string().min(1).optional(),
  /** Optional: absent, the engine's own `system stems` answers, one per machine. */
  chain: z.string().optional(),
  /** What to bring back: the four stems, or the record without its voice. */
  want: z.enum(["stems", INSTRUMENTAL]).optional(),
});

/** How long an engine's machine gets to take a jobs channel before the cut is refused. */
const OPEN_JOBS_MS = 10_000;

export function stemsRouter(
  engines: EngineMount,
  coldRun: CutDeps["coldRun"],
): Router {
  const router: Router = Router();
  const deps: CutDeps = {
    coldRun,
    jobsChannel: (id, roots) =>
      engines.tunnels.openReady(id, roots, OPEN_JOBS_MS, "jobs"),
  };

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

      const holder = claimHolder(req);
      const chosen = engineId ?? bestCutter(engines, holder);
      const engine = chosen ? engines.registry.get(chosen) : undefined;
      // A miss is a 409, not a 404: the remedy is to bring a machine back up.
      if (!engine)
        return res.status(409).json({
          error: engineId
            ? `no engine '${engineId}' is registered — is its machine running?`
            : "no engine is online to cut it — start k7 on one of your machines, or ask this server's admins for its engine",
          reason: "no-engine",
        });
      // A cut shares the account's files with that machine: its own, the server's, or one it is driving (../stems/engine.ts).
      if (!mayCut(engines, engine.id, holder))
        return res.status(403).json({
          error: `you hold no claim on engine '${engine.id}' — open it first`,
        });

      const id = jobIdFor(userEmail, song, `${chain ?? ""}\0${asked}`);
      const already = runningJob(id);
      if (already)
        return res.json({ ready: false, job: already } as StemsReply);

      const { progress, finish } = startJob(id, song);
      // Started and NOT awaited; the rejection is caught below, onto the job the poller reads.
      void cutStems({
        deps,
        engineId: engine.id,
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

  /** Is this song ALREADY cut — or being cut for this caller now? A READ: the POST above starts a job, so it cannot answer this. */
  router.get(
    "/held",
    wrap((req, res) => {
      const song = String(req.query.song ?? "");
      if (!song) return res.status(400).json({ error: "song is required" });
      const asked = req.query.want === INSTRUMENTAL ? INSTRUMENTAL : "stems";
      try {
        const ready = heldFor(song, asked);
        // A cut this caller started on the default chain, still running: a page reloaded mid-cut follows it again.
        const id = jobIdFor(emailOf(req) ?? "unknown", song, `\0${asked}`);
        const job = ready ? null : runningJob(id);
        // The same `ready` word the POST answers with, so one caller reads both the same way.
        res.json({ ready, job } as StemsReply);
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
