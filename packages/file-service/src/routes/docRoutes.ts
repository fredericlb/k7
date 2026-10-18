// docRoutes.ts — what a project COMPILES to — the documents, the graph, the errors, the tree and the hints —
// plus export, share and the sync state.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { validate, wrap } from "@frediverse/http/route";
import { NEEDS_META } from "@studio/take-render/render";
import { Router } from "express";
import { z } from "zod";
import { compileErrorBody } from "../compileError.ts";
import {
  liveConflicts,
  liveLogTail,
  projectSyncState,
  resolveConflict,
} from "../liveSync.ts";

export const docRouter: Router = Router();

// Render the mixdown and stream it. A throw before any bytes becomes a clean 400; after headers, only a log.
docRouter.get(
  "/export",
  wrap(async (req, res) => {
    const format = String(req.query.format ?? "wav") === "mp3" ? "mp3" : "wav";
    let out: {
      path: string;
      filename: string;
      mime: string;
      cleanup: () => void;
    };
    try {
      out = await req.ws!.exportMix(format);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.setHeader("Content-Type", out.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${out.filename}"`,
    );
    res.sendFile(out.path, (err) => {
      out.cleanup();
      if (err && !res.headersSent)
        res.status(400).json({ error: (err as Error).message });
    });
  }),
);

// Publish to k7: a song k7 doesn't know answers { needsMeta }, and the Share menu prompts and POSTs again.
const k7Body = z.object({
  artist: z.string().optional(),
  title: z.string().optional(),
});
docRouter.post(
  "/share/k7",
  validate(k7Body),
  wrap(async (req, res) => {
    try {
      const r = await req.ws!.shareK7(req.body as z.infer<typeof k7Body>);
      res.json({ ok: true, ...r });
    } catch (e) {
      const err = e as Error & { defaultTitle?: string };
      if (err.message === NEEDS_META) {
        res.json({
          ok: false,
          needsMeta: true,
          defaultTitle: err.defaultTitle ?? "",
        });
        return;
      }
      res.status(400).json({ error: err.message });
    }
  }),
);

/** Start sharing the open project at a checkpoint; the editor polls GET for where it is (docs/share.md). */
docRouter.post(
  "/share/link",
  wrap(async (req, res) => {
    req.ws!.startShareLink(req.userEmail!);
    res.status(202).json(req.ws!.shareLinkProgress());
  }),
);

docRouter.get(
  "/share/link",
  wrap(async (req, res) => {
    res.json(req.ws!.shareLinkProgress());
  }),
);

docRouter.get(
  "/project",
  wrap((req, res) => res.json(req.ws!.projectInfo())),
);
docRouter.get(
  "/project-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.projectDoc());
    } catch (e) {
      res.status(400).json(compileErrorBody(e));
    }
  }),
);

/** The same folder read as PICTURE — the `WebVideoProject` the viewport draws — see docs/fileRoutes.md. */
docRouter.get(
  "/video-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.videoProjectDoc());
    } catch (e) {
      res.status(400).json(compileErrorBody(e));
    }
  }),
);

docRouter.get(
  "/video-errors",
  wrap((req, res) => res.json(req.ws!.videoProjectErrors())),
);

/** The compiled `ProjectDoc` — what the ENGINE is given, not the shape a timeline draws (docs/fileRoutes.md). */
docRouter.get(
  "/engine-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.engineDoc());
    } catch (e) {
      // A project that will not compile: the message is the compiler's own, and the caller shows it.
      res.status(400).json(compileErrorBody(e));
    }
  }),
);
docRouter.get(
  "/graph",
  wrap((req, res) => {
    try {
      // `?at=<rel>` asks for a folder other than the open project — a library chain, through safePath.
      const at = String(req.query.at ?? "");
      res.json(req.ws!.graphDoc(at ? req.ws!.mediaPath(at) : undefined));
    } catch (e) {
      res.status(400).json(compileErrorBody(e));
    }
  }),
);
// The project's `surfaces/` folder, parsed — a DERIVED view like /graph, always 200 (docs/fileRoutes.md).
docRouter.get(
  "/surfaces",
  wrap((req, res) => res.json(req.ws!.surfaces())),
);
docRouter.get(
  "/project-errors",
  wrap((req, res) => res.json(req.ws!.projectErrors())),
);
// The change token: poll THIS, and fetch the expensive derivations only when it differs from the last one seen.
docRouter.get(
  "/revision",
  wrap((req, res) => res.json(req.ws!.revision())),
);
// What live sync captured in this workspace, newest last; 404 while it is off (docs/liveCapture.md).
docRouter.get(
  "/sync/log",
  wrap((req, res) => {
    const n = Math.min(Number(req.query.n) || 50, 500);
    const batches = liveLogTail(req.ws!, n);
    if (!batches) res.status(404).json({ error: "live sync is off" });
    else res.json({ batches });
  }),
);
// Whether a project is up to date with the relay — what the gate waits on before `/open` (docs/liveCapture.md).
docRouter.get(
  "/sync/project",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) res.status(400).json({ error: "path required" });
    else res.json(projectSyncState(req.ws!, path));
  }),
);
// Edits the relay set aside because the value had moved meanwhile, each with the value kept (docs/liveCapture.md).
docRouter.get(
  "/sync/conflicts",
  wrap((req, res) => {
    const conflicts = liveConflicts(req.ws!);
    // Unlinked is an ordinary state polled on every notice, so it answers an empty list rather than an error.
    res.json({ conflicts: conflicts ?? [], linked: conflicts !== null });
  }),
);
// Settle one: `take: true` writes the alternative over the value in place; either way it closes everywhere.
docRouter.post(
  "/sync/conflicts/:id",
  wrap((req, res) => {
    const out = resolveConflict(
      req.ws!,
      String(req.params.id),
      req.body?.take === true,
    );
    if (out === "ok") res.json({ ok: true });
    else
      res.status(404).json({
        error: out === "unknown" ? "no such conflict" : "not linked to a relay",
      });
  }),
);
docRouter.get(
  "/tree",
  wrap((req, res) => res.json(req.ws!.tree())),
);
// The whole workspace, not the open project — k7's home page looking inside a repository (docs/fileRoutes.md).
docRouter.get(
  "/workspace-tree",
  wrap((req, res) => res.json(req.ws!.workspaceTree())),
);
docRouter.get(
  "/hints",
  wrap((req, res) => res.json(req.ws!.hints())),
);
// Just the base-module refs, for the graph picker — a small slice of /hints, off the click's critical path.
docRouter.get(
  "/base-modules",
  wrap((req, res) => res.json(req.ws!.baseModules())),
);
// The declared inputs and outputs (modules under an io/ folder); the LEVELS come from the engine socket, not here.
docRouter.get(
  "/io-ports",
  wrap((req, res) => res.json(req.ws!.ioPorts())),
);
// The shared `_modules` catalogue — the module builder's list, which it then edits through /file.
docRouter.get(
  "/module-catalogue",
  wrap((req, res) => res.json(req.ws!.moduleCatalogue())),
);

// --- user presets ----------------------------------------------------------
