// render.ts (routes) — bounce a document to audio on this machine and stream the result
// back. Mounted BEFORE resolveWorkspace, like the médiathèque routes: a render is a property
// of the MACHINE (its engine binary, its plugins), not of anyone's workspace.
//
// The caller is a hosted backend outside this repository, which cannot exec anything itself.

import { rmSync } from "node:fs";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import { RenderError, renderProject } from "../render.ts";

export const renderRouter: Router = Router();

/** Render, stream the first file back, delete the rest — ONE request, one file, no job id (docs/render.md). */
renderRouter.post(
  "/render",
  wrap(async (req, res) => {
    const doc = req.body?.doc;
    if (!doc || typeof doc !== "object")
      return res.status(400).json({ error: "no doc" });

    let out: Awaited<ReturnType<typeof renderProject>> | null = null;
    try {
      out = await renderProject(doc, {
        baseDir:
          typeof req.body?.baseDir === "string" ? req.body.baseDir : undefined,
        mp3: req.body?.format === "mp3",
      });
      // Streamed, and the content type follows what was actually WRITTEN, since `mp3` is best-effort.
      const file = out.files[0];
      streamFile(
        req,
        res,
        file,
        file.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      );
    } catch (e) {
      // A RenderError is a diagnosis, and from the caller's side every failure otherwise looks identical.
      const known = e instanceof RenderError;
      if (!res.headersSent)
        res
          .status(known ? 422 : 500)
          .json({ error: known ? e.message : "render failed" });
    } finally {
      // Only on SUCCESS: `renderProject` owns its scratch directory through every failure it has.
      if (out)
        try {
          rmSync(out.dir, { recursive: true, force: true });
        } catch {
          /* the OS still has the handle open; the temp dir ages out on its own */
        }
    }
  }),
);
