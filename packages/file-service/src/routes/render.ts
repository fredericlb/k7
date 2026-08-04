// render.ts (routes) — bounce a document to audio on this machine and stream the result
// back. Mounted BEFORE resolveWorkspace, like the médiathèque cache: a render is a property
// of the MACHINE (its engine binary, its plugins), not of anyone's workspace.
//
// The one caller is z0's backend, which is hosted and cannot exec anything itself.

import { rmSync } from "node:fs";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import { RenderError, renderProject } from "../render.ts";

export const renderRouter: Router = Router();

/**
 * Render, stream the first file back, delete the rest.
 *
 * ONE request, one file, no job id. A render of a song takes seconds and the caller is a
 * server, not a browser — a polling protocol would be machinery in front of a wait that is
 * shorter than the poll interval. `--stems` is not offered here for the same reason: it
 * produces N files, which needs a job to hold them, and nothing asks for it.
 *
 * The temp directory is always removed — here on success, inside renderProject on every
 * failure — because a wedged machine renders repeatedly and each attempt costs a song's
 * worth of disk.
 */
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
      // Streamed, not read into memory: a render is a wav, and a long one is hundreds of
      // megabytes the hosted caller wants as a body rather than as a base64 field.
      //
      // The type follows what was actually WRITTEN, not what was asked for: `mp3` is
      // best-effort (see renderProject's asMp3), so a machine with no ffmpeg answers a wav and
      // has to say so, or the caller files it under the wrong extension.
      const file = out.files[0];
      streamFile(
        req,
        res,
        file,
        file.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      );
    } catch (e) {
      // A RenderError is a diagnosis — no binary, a bad document, a timeout — and saying
      // which is the whole value: from the caller's side every failure looks identical.
      const known = e instanceof RenderError;
      if (!res.headersSent)
        res
          .status(known ? 422 : 500)
          .json({ error: known ? e.message : "render failed" });
    } finally {
      // Only on SUCCESS: renderProject owns its scratch directory through every failure it
      // has, so `out` being set is exactly the case still holding one.
      if (out)
        try {
          rmSync(out.dir, { recursive: true, force: true });
        } catch {
          /* the OS still has the handle open; the temp dir ages out on its own */
        }
    }
  }),
);
