// engineLocal.ts (routes) — where a song of this volume is on an ENGINE's machine, so a browser can
// hand that engine a path it can open. The song is brought down through the engine's tunnel first,
// into the machine's copy of the médiathèque, so the answer is never a path to nothing. See
// ../../../docs/media/playbackTarget.md.

import { relative, sep } from "node:path";
import { validate, wrap } from "@frediverse/http/route";
import { claimHolder, type EngineMount } from "@studio/engine-registry";
import { JobError, requestJob } from "@studio/engine-tunnel/jobs-client";
import {
  mediatekDir,
  PathEscapesError,
  safePath,
} from "@studio/mediatek/layout";
import { Router } from "express";
import { z } from "zod";

/** A whole song may cross before the answer; long enough for a big master over a slow link. */
const OPEN_JOBS_MS = 10_000;

const body = z.object({
  engineId: z.string().min(1),
  /** Volume-relative, the string every other route here takes; `safePath` confines it. */
  path: z.string().min(1),
});

export function engineLocalRouter(engines: EngineMount): Router {
  const router: Router = Router();
  router.post(
    "/",
    validate(body),
    wrap(async (req, res) => {
      const { engineId, path } = req.body as z.infer<typeof body>;
      let abs: string;
      try {
        abs = safePath(path);
      } catch (e) {
        if (e instanceof PathEscapesError)
          return res.status(400).json({ error: e.message });
        throw e;
      }
      if (!engines.registry.get(engineId))
        return res
          .status(409)
          .json({ error: `no engine '${engineId}' is registered` });
      // Anyone may register an engine, so the caller must be driving it before a song is sent its way.
      if (!engines.registry.holds(engineId, claimHolder(req)))
        return res
          .status(403)
          .json({ error: `you hold no claim on engine '${engineId}'` });
      const root = mediatekDir();
      const ch = await engines.tunnels.openReady(
        engineId,
        [{ remote: root, name: "mediatek", writable: false }],
        OPEN_JOBS_MS,
        "jobs",
      );
      if (!ch)
        return res.status(503).json({
          error:
            "that engine is not connected to this server — its supervisor holds no tunnel here",
        });
      try {
        const reply = await requestJob(
          ch,
          // The tunnel's spelling: the root as shared, then `/`-joined, whatever this server's separator.
          {
            type: "local",
            path: `${root}/${relative(root, abs).split(sep).join("/")}`,
          },
          (r) => r.type === "local",
        );
        res.json({
          path: (reply.raw as { path?: string } | undefined)?.path ?? null,
        });
      } catch (e) {
        res
          .status(e instanceof JobError ? 404 : 502)
          .json({ error: (e as Error).message });
      } finally {
        ch.close();
      }
    }),
  );
  return router;
}
