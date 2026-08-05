// separate.ts (routes) — split a mix into stems on this machine. Mounted BEFORE
// resolveWorkspace, like render.ts and for the same reason: the model, the CPU and the GPU
// are properties of the MACHINE. Start-then-poll, unlike /render — see docs/stemSplit.md.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import { separateJob, startSeparate } from "../separateJobs.ts";

export const separateRouter: Router = Router();

/**
 * Where the stems go: `stems/` under the song's own folder, never beside the master.
 *
 * `apps/k7` already writes there and its docs/audio.md says why — `scanSongs` takes the FIRST
 * audio file in a folder as the master and does not descend, so a stem left alongside could be
 * played in place of the mixdown. Following the existing convention also means the médiathèque
 * needs no new idea to hold the result.
 */
export const STEMS_DIR = "stems";

/**
 * Start a separation and answer with a job to poll.
 *
 * Everything render.ts argues AGAINST a job for is true the other way round here, which is
 * what its own comment predicted: minutes rather than seconds, a person rather than a server
 * waiting, and N files, which "needs a job to hold them". This is the thing that asks.
 */
separateRouter.post(
  "/separate",
  wrap((req, res) => {
    const source = req.body?.source;
    const model = req.body?.model;
    // Absolute because the caller resolved them: the source comes off the médiathèque scan and
    // the model off the module's resolved asset. Refused rather than guessed at — this router
    // has no workspace to make a relative path mean something.
    if (typeof source !== "string" || !isAbsolute(source))
      return res.status(400).json({ error: "source must be an absolute path" });
    if (typeof model !== "string" || !isAbsolute(model))
      return res.status(400).json({ error: "model must be an absolute path" });
    if (!existsSync(source))
      return res.status(404).json({ error: `no such file: ${source}` });
    // A named 503, not a 500: a machine without the model is a real and fixable state, and
    // "separation failed" reads as a broken request rather than a missing download.
    if (!existsSync(model))
      return res.status(503).json({
        error:
          `no model at ${model} — stem separation needs the .onnx on this machine ` +
          `(~/.studio/models, or the module's own assets/)`,
      });

    res.json(
      startSeparate({
        userEmail: req.userEmail!,
        source,
        model,
        outDir: join(dirname(source), STEMS_DIR),
      }),
    );
  }),
);

separateRouter.get(
  "/separate/:id",
  wrap((req, res) => {
    const job = separateJob(req.params.id);
    // 404 rather than a synthetic "done", exactly as cloneJobs does: a job this service has
    // forgotten cannot be waited on, and the caller's real question — are the stems on disk? —
    // is one it can ask the disk directly.
    if (!job) return res.status(404).json({ error: "unknown separation job" });
    res.json(job);
  }),
);
