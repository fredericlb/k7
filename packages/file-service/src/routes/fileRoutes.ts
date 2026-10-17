// fileRoutes.ts — one file read, written or uploaded, a module's panel, consoles and engines, and the
// k7x migration.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { join, resolve } from "node:path";
import { validate, wrap } from "@frediverse/http/route";
import { K7X_BACKUP_DIR, migrateToK7x } from "@studio/song/k7xMigrate";
import { k7xEverywhere } from "@studio/song/yaml/workspaceFile";
import { MAX_UPLOAD_BYTES } from "@studio/web-protocol";
import { isWithin } from "@studio/web-protocol/paths";
import express, { type RequestHandler, Router } from "express";
import { z } from "zod";
import { startEngineForActive } from "../engineLink.ts";
import { skip } from "../workspaceFilter.ts";

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

const rawUpload = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });
/** The raw parser, with a too-large body answered as JSON in words — express's own 413 is an HTML page nobody reads. */
const uploadBody: RequestHandler = (req, res, next) =>
  rawUpload(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type !== "entity.too.large")
      return next(err);
    res.status(413).json({
      error: `larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB, the most one upload takes`,
    });
  });

// Drag-and-drop upload: raw body, target in the query, route-level raw parser. Refuses to overwrite (409).
fileRouter.post(
  "/upload",
  uploadBody,
  wrap((req, res) => {
    const dir = String(req.query.dir ?? ".");
    const name = String(req.query.name ?? "");
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes)) {
      res.status(400).json({ error: "empty upload" });
      return;
    }
    try {
      res.json(req.ws!.uploadFile(dir, name, bytes));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "EEXIST" ? 409 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

// The `ui.yaml` beside a module file; `path` may name either of the pair, so any click opens the same builder.
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

// The workspace's YAML files as .k7x, refused unless the operator says every device reads k7x (packages/song/docs/k7xFiles.md).
const k7xBody = z.object({ dryRun: z.boolean().optional() });
fileRouter.post(
  "/migrate-k7x",
  validate(k7xBody),
  wrap(async (req, res) => {
    const dryRun = (req.body as z.infer<typeof k7xBody>).dryRun === true;
    if (!dryRun && !k7xEverywhere()) {
      res.status(409).json({
        error:
          "k7x conversion is off: set STUDIO_K7X=1 once every desktop and phone build reads .k7x",
      });
      return;
    }
    const ws = req.ws!;
    const backup = join(
      ws.root,
      K7X_BACKUP_DIR,
      new Date().toISOString().replace(/[:.]/g, "-"),
    );
    const run = () =>
      migrateToK7x(ws.root, {
        backup,
        dryRun,
        skip: (rel) => rel.split("/").some(skip),
      });
    const report = dryRun
      ? run()
      : (await ws.recordChange("convert to k7x", run)).value;
    if (!dryRun) ws.invalidateProjectDoc();
    res.json({ dryRun, backup: dryRun ? null : backup, ...report });
  }),
);

const fmtBody = z.object({ path: z.string().min(1) });
fileRouter.post(
  "/fmt",
  validate(fmtBody),
  wrap((req, res) => {
    res.json(req.ws!.fmt((req.body as z.infer<typeof fmtBody>).path));
  }),
);
