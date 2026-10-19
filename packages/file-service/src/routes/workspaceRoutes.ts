// workspaceRoutes.ts — the workspace's own answers: what it holds and which project is open, the preferences,
// the plugins a project needs, the libraries and lists it reaches, and a module created.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import { z } from "zod";
import {
  engineLoadOf,
  engineSyncOf,
  prewarmEngineForActive,
  retryEngineSync,
  takeJustRecorded,
  thawAutoFreeze,
} from "../engineLink.ts";
import { libraryVersionsAt } from "../libraryPins.ts";
import { startModelDownload } from "../modelDownloads.ts";
import { preferences, setVim } from "../workspace.ts";

export const workspaceRouter: Router = Router();

workspaceRouter.get(
  "/workspace",
  wrap((req, res) => {
    // Idempotent while the engine is idle, so plugin instantiation overlaps the browser's remaining startup.
    prewarmEngineForActive(req.ws!);
    // The last take rides this two-second poll rather than getting a route — see docs/fileRoutes.md.
    res.json({
      ...req.ws!.workspaceInfo(),
      lastTake: takeJustRecorded(req.ws!),
      engineSync: engineSyncOf(req.ws!),
      engineLoad: engineLoadOf(req.ws!),
    });
  }),
);

// Global machine preferences (audio interface + channel labels + vim). Not per-workspace.
workspaceRouter.get(
  "/preferences",
  wrap((_req, res) => res.json(preferences())),
);
const vimBody = z.object({ vim: z.boolean() });
workspaceRouter.put(
  "/preferences/vim",
  validate(vimBody),
  wrap((req, res) => {
    res.json({ vim: setVim((req.body as z.infer<typeof vimBody>).vim) });
  }),
);
// No input-pair route: grouping an interface's inputs is `system channel type` — see docs/fileRoutes.md.

/** The plugins a project of this workspace needs its engine to host — asked BEFORE an engine is chosen, see docs/fileRoutes.md. */
workspaceRouter.get(
  "/project-plugins",
  wrap((req, res) => {
    const project = String(req.query.project ?? "");
    if (!project) return res.status(400).json({ error: "project is required" });
    try {
      res.json({ plugins: req.ws!.pluginNeeds(project) });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  }),
);

/** …and that project SCORED against this machine's engine, for a project living beside its engine — see docs/fileRoutes.md. */
workspaceRouter.get(
  "/project-compat",
  wrap((req, res) => {
    const project = String(req.query.project ?? "");
    if (!project) return res.status(400).json({ error: "project is required" });
    try {
      res.json({ compat: req.ws!.pluginCompat(project) });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  }),
);

/** Leave an automatically frozen VST live while somebody edits it (`on`), or let it freeze again — packages/song/docs/autoFreeze.md. */
const thawBody = z.object({ module: z.string().min(1), on: z.boolean() });
workspaceRouter.post(
  "/auto-freeze/thaw",
  validate(thawBody),
  wrap((req, res) => {
    const { module, on } = req.body as z.infer<typeof thawBody>;
    thawAutoFreeze(req.ws!, module, on);
    res.json({ ok: true });
  }),
);

/** After a failed copy held the project back, the one way to try again — see docs/engineSync.md. */
workspaceRouter.post(
  "/engine/sync/retry",
  wrap((req, res) => {
    retryEngineSync(req.ws!);
    res.json({ ok: true });
  }),
);

/** The module libraries this project can reach, in precedence order — see docs/fileRoutes.md. */
workspaceRouter.get(
  "/module-libraries",
  wrap(async (req, res) => {
    const ws = req.ws!;
    // A library row carries its version too: what this workspace plays, and what it could move to.
    const versions = await libraryVersionsAt(ws.activeProjectPath() ?? ws.root);
    res.json({
      libraries: ws.moduleLibraries().map((l) => {
        const version = versions.get(l.ns);
        return version ? { ...l, version } : l;
      }),
    });
  }),
);

/** Fetch a node's missing model from its module's `model_url`; `job: null` means already here — docs/libraries.md. */
workspaceRouter.post(
  "/models/download",
  validate(z.object({ node: z.string().min(1) })),
  wrap((req, res) => {
    const { node } = req.body as { node: string };
    let need: ReturnType<NonNullable<typeof req.ws>["missingModelOf"]>;
    try {
      need = req.ws!.missingModelOf(node);
    } catch (e) {
      return res.status(404).json({ error: (e as Error).message });
    }
    if (!need) return res.json({ job: null });
    if (!need.url)
      return res.status(400).json({
        error: `'${node}' needs the model '${need.file}' and its module gives no model_url to fetch it from`,
      });
    res.json({ job: startModelDownload(need.file, need.url) });
  }),
);

/** The chains the library repository holds — what k7's chains builder lists. */
workspaceRouter.get(
  "/library-chains",
  wrap((req, res) => {
    res.json({ chains: req.ws!.libraryChains() });
  }),
);

/** …and the assembly templates it holds, which is the same question about the third family. */
workspaceRouter.get(
  "/library-assemblies",
  wrap((req, res) => {
    res.json({ assemblies: req.ws!.libraryAssemblies() });
  }),
);

/** The LISTING of `_playlists/`; reading and writing one are `/file` and `/write` — see docs/fileRoutes.md. */
workspaceRouter.get(
  "/playlists",
  wrap((req, res) => {
    res.json({ playlists: req.ws!.playlists() });
  }),
);

// No route makes a playlist: that is the `playlist new` command — see docs/fileRoutes.md.

/** The LISTING of `_references/`; a track is uploaded with `/upload` and played over `/media`. */
workspaceRouter.get(
  "/references",
  wrap((req, res) => {
    res.json({ references: req.ws!.references() });
  }),
);

/** Make an empty module: `<root>/<type>/<name>/module.k7x` — see docs/fileRoutes.md for `root`'s rule. */
const moduleBody = z.object({
  root: z.string().min(1),
  rel: z.string().min(1),
});
workspaceRouter.post(
  "/module",
  validate(moduleBody),
  wrap((req, res) => {
    const { root, rel } = req.body as z.infer<typeof moduleBody>;
    try {
      res.json(req.ws!.createModule(root, rel));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
