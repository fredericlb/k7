// files.ts — the project file API, re-rooted per-workspace. Mounted after
// resolveWorkspace, so `req.ws` is always a Workspace here. Every former store call
// is now a method on that workspace; the command layer takes it explicitly.

import { validate, wrap } from "@frediverse/http/route";
import {
  alternatives,
  commitAndPush,
  gitStatus,
  pull,
} from "@studio/commands/git";
import { NEEDS_META } from "@studio/commands/render";
import {
  applyPresetToModule,
  listModulePresets,
  saveModuleAsPreset,
} from "@studio/song/presets";
import express, { Router } from "express";
import { z } from "zod";
import {
  enginePreview,
  prewarmEngineForActive,
  reloadActiveProject,
  runWebCommand,
  startEngineForActive,
  strudelOrbitTracks,
  unloadEngine,
  unloadEngineIfServing,
  webCommandList,
  webCompletions,
  webGitEnv,
} from "../engineLink.ts";
import { readLog } from "../logs.ts";
import { preferences, setVim, toWebTracks } from "../workspace.ts";

export const filesRouter = Router();

// NOTE: /media lives in server.ts, outside the header gates — a <video> GET can't set custom headers, so it
// authenticates via the query. No single-tab lease: last write wins, and each tab's next poll reconciles.

filesRouter.get(
  "/workspace",
  wrap((req, res) => {
    // Idempotent while the engine is idle, so plugin instantiation overlaps the browser's remaining startup.
    prewarmEngineForActive(req.ws!);
    res.json(req.ws!.workspaceInfo());
  }),
);

// Global machine preferences (audio interface + channel labels + vim). Not per-workspace.
filesRouter.get(
  "/preferences",
  wrap((_req, res) => res.json(preferences())),
);
const vimBody = z.object({ vim: z.boolean() });
filesRouter.put(
  "/preferences/vim",
  validate(vimBody),
  wrap((req, res) => {
    res.json({ vim: setVim((req.body as z.infer<typeof vimBody>).vim) });
  }),
);

const openBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/open",
  validate(openBody),
  wrap((req, res) => {
    const { path } = req.body as z.infer<typeof openBody>;
    try {
      req.ws!.setActiveProject(path);
      startEngineForActive(req.ws!);
      res.json(req.ws!.workspaceInfo());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Unload the project and recycle its folder, whence it can't be started; a bad or recycled project is a 400.
const deleteProjectBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/project/delete",
  validate(deleteProjectBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof deleteProjectBody>;
    try {
      const { recycled } = await req.ws!.deleteProject(path, (abs) =>
        unloadEngineIfServing(abs),
      );
      res.json({ recycled });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Make an empty folder inside `dir`; 400 on a bad name, a clobber, or the recycle bin.
const newFolderBody = z.object({
  dir: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/folder",
  validate(newFolderBody),
  wrap((req, res) => {
    const { dir, name } = req.body as z.infer<typeof newFolderBody>;
    try {
      res.json(req.ws!.createFolder(dir, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Rename a tree entry within its parent; 400 on a bad path, a clobber, or a protected entry.
const renameBody = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/rename",
  validate(renameBody),
  wrap(async (req, res) => {
    const { path, name } = req.body as z.infer<typeof renameBody>;
    try {
      res.json(await req.ws!.renameEntry(path, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Move an entry into another folder (the tree's drag-and-drop); 400 on a bad path, a clobber, or a move into self.
const moveBody = z.object({
  path: z.string().min(1),
  toDir: z.string().min(1),
});
filesRouter.post(
  "/move",
  validate(moveBody),
  wrap(async (req, res) => {
    const { path, toDir } = req.body as z.infer<typeof moveBody>;
    try {
      res.json(await req.ws!.moveEntry(path, toDir));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Delete by recycling — reversible, returning the recycled path; 400 on a bad path or a protected entry.
const deleteEntryBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/entry/delete",
  validate(deleteEntryBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof deleteEntryBody>;
    try {
      res.json(await req.ws!.deleteEntry(path));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Clone a module folder in the same category with a new name.
const cloneModuleBody = z.object({
  path: z.string().min(1),
  newName: z.string().min(1),
});
filesRouter.post(
  "/module/clone",
  validate(cloneModuleBody),
  wrap((req, res) => {
    const { path, newName } = req.body as z.infer<typeof cloneModuleBody>;
    try {
      res.json(req.ws!.cloneModule(path, newName));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Add an instance beside a module.yaml, which it inherits; `path` is the folder or any file in it.
const moduleInstanceBody = z.object({
  path: z.string().min(1),
  instance: z.string().min(1),
});
filesRouter.post(
  "/module/instance",
  validate(moduleInstanceBody),
  wrap((req, res) => {
    const { path, instance } = req.body as z.infer<typeof moduleInstanceBody>;
    try {
      res.json(req.ws!.createModuleInstance(path, instance));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Import a foreign project (.dawproject, .als) into a new project folder and return its path, which
// the caller then /opens.
const importBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/import-project",
  validate(importBody),
  wrap((req, res) => {
    const { path } = req.body as z.infer<typeof importBody>;
    try {
      res.json(req.ws!.importProject(path));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Scaffold a project at the workspace root and return its path — the same scaffold `l8 create` runs.
const createProjectBody = z.object({
  type: z.enum(["audio", "video"]),
  name: z.string().min(1),
});
filesRouter.post(
  "/project/create",
  validate(createProjectBody),
  wrap((req, res) => {
    const { type, name } = req.body as z.infer<typeof createProjectBody>;
    try {
      res.json(req.ws!.createProject(type, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Quitting: stop and flush the engine and forget the active project. Another tab driving it will pick it back up.
filesRouter.post(
  "/engine/unload",
  wrap(async (_req, res) => {
    await unloadEngine();
    res.json({ ok: true });
  }),
);

filesRouter.get(
  "/commands",
  wrap((_req, res) => res.json(webCommandList())),
);
filesRouter.get(
  "/complete",
  wrap((req, res) =>
    res.json(webCompletions(req.ws!, String(req.query.line ?? ""))),
  ),
);
const cmdBody = z.object({ line: z.string() });
filesRouter.post(
  "/command",
  validate(cmdBody),
  wrap(async (req, res) => {
    const { line } = req.body as z.infer<typeof cmdBody>;
    // req.userEmail lets commit/pull pin git to this user's deploy key (see makeHost).
    res.json({ output: await runWebCommand(req.ws!, line, req.userEmail) });
  }),
);

// Where the repo stands vs upstream, polled by the share badge: a bounded best-effort fetch, then ahead/behind.
filesRouter.get(
  "/git/status",
  wrap((req, res) => {
    res.json(gitStatus(req.ws!.root, webGitEnv(req.userEmail)));
  }),
);

// The alternatives the header dropdown lists, with the branch each was started from.
// Local reads only (no fetch), so it is cheap enough to poll beside the status badge.
filesRouter.get(
  "/git/alternatives",
  wrap((req, res) => {
    res.json(alternatives(req.ws!.root, webGitEnv(req.userEmail)));
  }),
);

// Commit + push the WHOLE workspace repo, pinned to the user's deploy key; needs no active project.
const gitCommitBody = z.object({ message: z.string().min(1) });
filesRouter.post(
  "/git/commit",
  validate(gitCommitBody),
  wrap((req, res) => {
    const { message } = req.body as z.infer<typeof gitCommitBody>;
    try {
      res.json(commitAndPush(req.ws!.root, message, webGitEnv(req.userEmail)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Fast-forward the WHOLE repo. A pull may have rewritten the active project, so reload it (a no-op when none).
filesRouter.post(
  "/git/pull",
  wrap((req, res) => {
    try {
      const r = pull(req.ws!.root, webGitEnv(req.userEmail));
      if (!r.upToDate) reloadActiveProject(req.ws!);
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Render the mixdown and stream it. A throw before any bytes becomes a clean 400; after headers, only a log.
filesRouter.get(
  "/export",
  wrap((req, res) => {
    const format = String(req.query.format ?? "wav") === "mp3" ? "mp3" : "wav";
    let out: {
      path: string;
      filename: string;
      mime: string;
      cleanup: () => void;
    };
    try {
      out = req.ws!.exportMix(format);
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
filesRouter.post(
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

filesRouter.get(
  "/project",
  wrap((req, res) => res.json(req.ws!.projectInfo())),
);
filesRouter.get(
  "/strudel-tracks",
  wrap((_req, res) => res.json(toWebTracks(strudelOrbitTracks()))),
);
filesRouter.get(
  "/project-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.projectDoc());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
filesRouter.get(
  "/graph",
  wrap((req, res) => {
    try {
      res.json(req.ws!.graphDoc());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
filesRouter.get(
  "/project-errors",
  wrap((req, res) => res.json(req.ws!.projectErrors())),
);
// The change token: poll THIS, and fetch the expensive derivations only when it differs from the last one seen.
filesRouter.get(
  "/revision",
  wrap((req, res) => res.json(req.ws!.revision())),
);
filesRouter.get(
  "/tree",
  wrap((req, res) => res.json(req.ws!.tree())),
);
filesRouter.get(
  "/hints",
  wrap((req, res) => res.json(req.ws!.hints())),
);
// Just the base-module refs, for the graph picker — a small slice of /hints, off the click's critical path.
filesRouter.get(
  "/base-modules",
  wrap((req, res) => res.json(req.ws!.baseModules())),
);
// The declared inputs and outputs (modules under an io/ folder, the shared ones included).
// Read once when the I/O panel opens; the LEVELS come from the engine socket, not here.
filesRouter.get(
  "/io-ports",
  wrap((req, res) => res.json(req.ws!.ioPorts())),
);
// The shared `_modules` catalogue — the module builder's list. Read when it opens; the
// builder then edits each module's own file through the ordinary read/write routes.
filesRouter.get(
  "/module-catalogue",
  wrap((req, res) => res.json(req.ws!.moduleCatalogue())),
);

// --- user presets ----------------------------------------------------------
// Project-local presets live in the SONG, which the engine never sees, so they are handled brain-side.

// `?ref=` is the module's own ref; an empty list (never an error) when nothing can hold presets.
filesRouter.get(
  "/presets",
  wrap((req, res) => {
    const ref = String(req.query.ref ?? "");
    if (!ref) {
      res.status(400).json({ error: "ref required" });
      return;
    }
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.json({ presets: [] });
      return;
    }
    try {
      res.json({ presets: listModulePresets(dir, ref) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Save a module's current persisted state as a new preset in its own preset library.
const savePresetBody = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/presets/save",
  validate(savePresetBody),
  wrap((req, res) => {
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    const { module, name } = req.body as z.infer<typeof savePresetBody>;
    try {
      res.json({ path: saveModuleAsPreset(dir, module, name) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Apply one of a module's own presets, then reload. BY NAME: the shelf is a file in the module's folder now
// (see presets.ts), so there is no path in the body and nothing for a crafted one to escape.
const applyPresetBody = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/presets/apply",
  validate(applyPresetBody),
  wrap((req, res) => {
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    const { module, name } = req.body as z.infer<typeof applyPresetBody>;
    try {
      applyPresetToModule(dir, module, name);
      reloadActiveProject(req.ws!);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.post(
  "/waveforms/prewarm",
  wrap((req, res) => {
    void req.ws!.prewarmWaveforms();
    res.json(req.ws!.waveformStatus());
  }),
);
filesRouter.get(
  "/waveforms/status",
  wrap((req, res) => res.json(req.ws!.waveformStatus())),
);
filesRouter.post(
  "/waveforms/clear",
  wrap((req, res) => {
    const removed = req.ws!.clearWaveformCache();
    res.json({ ok: true, removed });
  }),
);
// The merged log for the Logs panel: `?tail=N` seeds, `?offset=X` continues. Machine-global, not per workspace.
filesRouter.get(
  "/logs",
  wrap((req, res) => {
    const rawOffset = Number(req.query.offset);
    const offset =
      req.query.offset != null && Number.isFinite(rawOffset)
        ? rawOffset
        : undefined;
    const tail = Math.max(1, Math.min(2000, Number(req.query.tail) || 300));
    res.json(readLog({ offset, tail }));
  }),
);
filesRouter.get(
  "/waveform",
  wrap(async (req, res) => {
    const clip = String(req.query.clip ?? "");
    if (!clip) {
      res.status(400).json({ error: "clip required" });
      return;
    }
    const buckets = Math.max(
      16,
      Math.min(4000, Number(req.query.buckets) || 1000),
    );
    // `whole=1` asks for the source's full duration rather than the placement's span — what a clips/*.yaml shows.
    const whole = req.query.whole === "1" || req.query.whole === "true";
    try {
      res.json(await req.ws!.waveform(clip, buckets, whole));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

// Audition one sample: resolve it to a file + window and let the engine fire a voice, independent of the transport.
const previewBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), source: z.string().min(1) }),
  z.object({ kind: z.literal("clip"), clip: z.string().min(1) }),
  z.object({
    kind: z.literal("slice"),
    source: z.string().min(1),
    from: z.number(),
    to: z.number(),
  }),
]);
filesRouter.post(
  "/preview",
  validate(previewBody),
  wrap((req, res) => {
    try {
      const { file, start, length } = req.ws!.resolvePreview(
        req.body as z.infer<typeof previewBody>,
      );
      enginePreview(file, start, length);
      res.json({ ok: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
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
filesRouter.put(
  "/file",
  validate(writeBody),
  wrap((req, res) => {
    const { path, content } = req.body as z.infer<typeof writeBody>;
    try {
      // `forked` is set when the target was a shared module: the save landed on a project-local copy, and the
      // editor has to follow it — the file it had open is unchanged and still read-only.
      res.json({ ok: true, ...req.ws!.write(path, content) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Drag-and-drop upload: raw body, target in the query, route-level raw parser. Refuses to overwrite (409).
filesRouter.post(
  "/upload",
  express.raw({ type: () => true, limit: "512mb" }),
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

// The `ui.yaml` beside a module file, which its grid edits — existing or scaffolded, saved through PUT /file
// like any other. `path` may name either of the pair, so a click on the panel opens the same builder.
filesRouter.get(
  "/module-ui",
  wrap((req, res) => {
    try {
      res.json(req.ws!.moduleUi(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Give an engine module a folder in the project, so it can carry a panel and presets. POST because it writes:
// a module file appears and the chains are repointed (see moduleFork.ts).
const materialiseBody = z.object({ ref: z.string().min(1) });
filesRouter.post(
  "/module-materialise",
  validate(materialiseBody),
  wrap((req, res) => {
    const { ref } = req.body as z.infer<typeof materialiseBody>;
    try {
      res.json(req.ws!.materialiseModule(ref));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// The `presets.yaml` beside a module file — the module's third file, answered like its panel.
filesRouter.get(
  "/module-presets",
  wrap((req, res) => {
    try {
      res.json(req.ws!.modulePresets(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

const fmtBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/fmt",
  validate(fmtBody),
  wrap((req, res) => {
    res.json(req.ws!.fmt((req.body as z.infer<typeof fmtBody>).path));
  }),
);
