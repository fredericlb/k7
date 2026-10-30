// fileRoutes.ts — one file read, written or uploaded, a module's panel, consoles and engines.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { resolve } from "node:path";
import { validate, wrap } from "@frediverse/http/route";
import { MAX_UPLOAD_BYTES } from "@studio/web-protocol";
import { isWithin } from "@studio/web-protocol/paths";
import { Router } from "express";
import { z } from "zod";
import { startEngineForActive } from "../engineLink.ts";
import { uploadTooLarge } from "../workspaceEntries.ts";

export const fileRouter: Router = Router();

fileRouter.get(
  "/file",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) {
      res.status(400).json({ error: "path required" });
      return;
    }
    try {
      res.json(req.ws!.read(path));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

const writeBody = z.object({
  path: z.string().min(1),
  content: z.string(),
});
fileRouter.put(
  "/file",
  validate(writeBody),
  wrap(async (req, res) => {
    const { path, content } = req.body as z.infer<typeof writeBody>;
    try {
      // `forked` says the save landed on a project-local copy of a shared module — see docs/fileRoutes.md.
      const r = await req.ws!.recordChange(`edit ${path}`, () =>
        req.ws!.write(path, content),
      );
      // TWO gates — the token moved AND the path is inside the open song — before the engine is pushed to.
      const active = req.ws!.activeProjectPath();
      const abs = resolve(req.ws!.root, path);
      if (r.after !== r.before && active && isWithin(active, abs))
        startEngineForActive(req.ws!);
      // `.value` because a journalled mutation also answers with the tokens either side of it.
      res.json({ ok: true, ...r.value });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Drag-and-drop upload: the body streamed to disk beside its target, never held in memory. Refuses to overwrite (409).
fileRouter.post(
  "/upload",
  wrap(async (req, res) => {
    const dir = String(req.query.dir ?? ".");
    const name = String(req.query.name ?? "");
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    // Said in words: express's own 413 is an HTML page nobody reads.
    if (Number(req.headers["content-length"]) > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: uploadTooLarge(MAX_UPLOAD_BYTES).message });
      return;
    }
    // The app-wide JSON parser got here first: the stream is spent.
    if ((req as { _body?: boolean })._body || req.readableEnded) {
      res
        .status(415)
        .json({ error: "send the bytes as application/octet-stream" });
      return;
    }
    try {
      res.json(await req.ws!.uploadStream(dir, name, req, MAX_UPLOAD_BYTES));
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { status?: number };
      const code = err.code === "EEXIST" ? 409 : (err.status ?? 400);
      res.status(code).json({ error: err.message });
    }
  }),
);

// The `ui.k7x` beside a module file; `path` may name either of the pair, so any click opens the same builder.
fileRouter.get(
  "/module-ui",
  wrap((req, res) => {
    try {
      res.json(req.ws!.moduleUi(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// The console systems the project may run, for the settings' Project tab — packages/song/docs/console.md.
fileRouter.get(
  "/consoles",
  wrap((req, res) => {
    try {
      res.json(req.ws!.consoles());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// The ENGINES beside a module file, for the builder's strip — packages/song/docs/engines.md.
fileRouter.get(
  "/module-engines",
  wrap((req, res) => {
    try {
      res.json(req.ws!.moduleEngines(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

const fmtBody = z.object({ path: z.string().min(1) });
fileRouter.post(
  "/fmt",
  validate(fmtBody),
  // Reads the file back after a save, formatting NOTHING — both editors call it and use the reply.
  wrap((req, res) => {
    res.json(req.ws!.read((req.body as z.infer<typeof fmtBody>).path));
  }),
);
