// separate.ts (routes) — split a mix into stems on this machine. Mounted BEFORE
// resolveWorkspace, like render.ts and for the same reason: the model, the CPU and the GPU
// are properties of the MACHINE. Start-then-poll, unlike /render — see docs/stemSplit.md.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { wrap } from "@frediverse/http/route";
import { STEMS_DIR } from "@studio/song-schema/stems";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { Router } from "express";

export const separateRouter: Router = Router();

// Stems go under the song's own folder, never beside the master, and the word is named ONCE in @studio/song.

/** Start a separation and answer with a job to poll: minutes, a person waiting, and N files. */
separateRouter.post(
  "/separate",
  wrap((req, res) => {
    const source = req.body?.source;
    const model = req.body?.model;
    // Absolute because the caller resolved them; this router has no workspace to make a relative path mean anything.
    if (typeof source !== "string" || !isAbsolute(source))
      return res.status(400).json({ error: "source must be an absolute path" });
    if (typeof model !== "string" || !isAbsolute(model))
      return res.status(400).json({ error: "model must be an absolute path" });
    if (!existsSync(source))
      return res.status(404).json({ error: `no such file: ${source}` });
    // A named 503, not a 500: a machine without the model is a real and fixable state.
    if (!existsSync(model))
      return res.status(503).json({
        error:
          `no model at ${model} — stem separation needs the .onnx on this machine ` +
          `(~/.st0/models, or the module's own assets/)`,
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
    // 404 rather than a synthetic "done", as cloneJobs does: a forgotten job cannot be waited on.
    if (!job) return res.status(404).json({ error: "unknown separation job" });
    res.json(job);
  }),
);
