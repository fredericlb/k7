// files.ts — the project file API, re-rooted per-workspace. Mounted after
// resolveWorkspace, so `req.ws` is always a Workspace here. Every former store call
// is now a method on that workspace; the command layer takes it explicitly.

import { resolve, sep } from "node:path";
import { validate, wrap } from "@frediverse/http/route";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { listNodePresets } from "@studio/song-edit/presets";
import { PROJECT_SHAPES } from "@studio/song-schema/yaml/projectSchema";
import { NEEDS_META } from "@studio/take-render/render";
import { ADMIN_HEADER } from "@studio/web-protocol";
import express, { Router } from "express";
import { z } from "zod";
import { guard } from "../background.ts";
import {
  applyClientProject,
  engineLoadOf,
  enginePreview,
  engineSyncOf,
  prewarmEngineForActive,
  retryEngineSync,
  runWebCommand,
  snapshotPluginBase,
  startEngineForActive,
  takeJustRecorded,
  thawAutoFreeze,
  unloadEngine,
  unloadEngineIfServing,
  webCommandList,
  webCompletions,
} from "../engineLink.ts";
import { refreshLibraries } from "../libraries.ts";
import { ensureLibraryPins, libraryVersionsAt } from "../libraryPins.ts";
import { liveConflicts, liveLogTail, resolveConflict } from "../liveSync.ts";
import { boundMachineLog } from "../machineLog.ts";
import { startModelDownload } from "../modelDownloads.ts";
import { resolvePlugin } from "../pluginRef.ts";
import { serviceLogSince } from "../serviceLog.ts";
import { preferences, setAudioDevicePref, setVim } from "../workspace.ts";

export const filesRouter = Router();

// /media lives in server.ts, outside the header gates, and there is no single-tab lease — see docs/fileRoutes.md.

filesRouter.get(
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
// The interface this machine plays through, remembered here because the engine keeps none — see docs/fileRoutes.md.
const audioDeviceBody = z.object({
  name: z.string(),
  type: z.string().optional(),
});
filesRouter.put(
  "/preferences/audio-device",
  validate(audioDeviceBody),
  wrap((req, res) => {
    const { name, type } = req.body as z.infer<typeof audioDeviceBody>;
    res.json({ audioDevice: setAudioDevicePref(name, type) });
  }),
);
// No input-pair route: grouping an interface's inputs is `system channel type` — see docs/fileRoutes.md.

/** The plugins a project of this workspace needs its engine to host — asked BEFORE an engine is chosen, see docs/fileRoutes.md. */
filesRouter.get(
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
filesRouter.get(
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
filesRouter.post(
  "/auto-freeze/thaw",
  validate(thawBody),
  wrap((req, res) => {
    const { module, on } = req.body as z.infer<typeof thawBody>;
    thawAutoFreeze(req.ws!, module, on);
    res.json({ ok: true });
  }),
);

/** After a failed copy held the project back, the one way to try again — see docs/engineSync.md. */
filesRouter.post(
  "/engine/sync/retry",
  wrap((req, res) => {
    retryEngineSync(req.ws!);
    res.json({ ok: true });
  }),
);

/** The module libraries this project can reach, in precedence order — see docs/fileRoutes.md. */
filesRouter.get(
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

/**
 * Fetch the model a NODE of the open project names and this machine has not got — the right-click's
 * "Download model". The URL is the module's `model_url`, never the caller's; the job is polled at
 * `GET /account/models/:id`. `job: null` is "already here", so a stale menu costs nothing.
 */
filesRouter.post(
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

/** The chains the library repository holds — what st0's chains builder lists. */
filesRouter.get(
  "/library-chains",
  wrap((req, res) => {
    res.json({ chains: req.ws!.libraryChains() });
  }),
);

/** …and the assembly templates it holds, which is the same question about the third family. */
filesRouter.get(
  "/library-assemblies",
  wrap((req, res) => {
    res.json({ assemblies: req.ws!.libraryAssemblies() });
  }),
);

/** The LISTING of `_playlists/`; reading and writing one are `/file` and `/write` — see docs/fileRoutes.md. */
filesRouter.get(
  "/playlists",
  wrap((req, res) => {
    res.json({ playlists: req.ws!.playlists() });
  }),
);

// No route makes a playlist: that is the `playlist new` command — see docs/fileRoutes.md.

/** The LISTING of `_references/`; a track is uploaded with `/upload` and played over `/media`. */
filesRouter.get(
  "/references",
  wrap((req, res) => {
    res.json({ references: req.ws!.references() });
  }),
);

/** Make an empty module: `<root>/<type>/<name>/module.yaml` — see docs/fileRoutes.md for `root`'s rule. */
const moduleBody = z.object({
  root: z.string().min(1),
  rel: z.string().min(1),
});
filesRouter.post(
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

/** Open a project — the account's LIBRARIES brought up to date first — see docs/fileRoutes.md. */
const openBody = z.object({
  path: z.string().min(1),
  // Sent by browsers that still hold the old single URI; the file service knows the list itself.
  libraries: z.string().optional(),
});
filesRouter.post(
  "/open",
  validate(openBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof openBody>;
    // The libraries given their folders, and writable in place for an admin — docs/libraries.md.
    const admin = req.get(ADMIN_HEADER) === "1";
    await refreshLibraries(admin);
    // A workspace from before versions pins what it already hears, once.
    ensureLibraryPins(req.ws!.root, { fresh: false, admin });
    try {
      // `.` is the WORKSPACE, which now holds several projects: it names one only when the
      // folder itself is one. Otherwise the workspace decides — see docs/workspaces.md.
      const want = path === "." ? req.ws!.defaultProject() : path;
      // A workspace with no project at all opens as a tree; there is nothing to start.
      if (want) {
        req.ws!.setActiveProject(want);
        startEngineForActive(req.ws!);
      }
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

// Rename a project folder in place, suffix kept; the engine STOPS when it is serving that folder.
const renameProjectBody = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/project/rename",
  validate(renameProjectBody),
  wrap(async (req, res) => {
    const { path, name } = req.body as z.infer<typeof renameProjectBody>;
    try {
      res.json(
        await req.ws!.renameProject(path, name, (abs) =>
          unloadEngineIfServing(abs),
        ),
      );
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

// Move a LIBRARY module to another folder of its library; its refs follow it (packages/song/docs/moduleMove.md).
filesRouter.post(
  "/library/move",
  validate(moveBody),
  wrap(async (req, res) => {
    const { path, toDir } = req.body as z.infer<typeof moveBody>;
    try {
      res.json(await req.ws!.moveLibraryModule(path, toDir));
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

// Add a node beside a module.yaml, which it inherits; `path` is the folder or any file in it.
const nodeBody = z.object({
  path: z.string().min(1),
  // Optional: without one the service names the node `<module>_<n>` — see Workspace.createNode.
  node: z.string().min(1).optional(),
});
filesRouter.post(
  "/node",
  validate(nodeBody),
  wrap((req, res) => {
    const { path, node } = req.body as z.infer<typeof nodeBody>;
    try {
      res.json(req.ws!.createNode(path, node));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Import a foreign project (.dawproject, .als) into a new folder and return its path, which the caller then /opens.
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

// A project DROPPED on a workspace: raw body, the file's name and the chosen folder in the query.
// Nothing is left behind — the bytes are translated, never written into the workspace (docs/import.md).
filesRouter.post(
  "/import-upload",
  express.raw({ type: () => true, limit: "512mb" }),
  wrap((req, res) => {
    const file = String(req.query.file ?? "");
    const name = String(req.query.name ?? "");
    if (!file || !name)
      return res.status(400).json({ error: "file and name required" });
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      return res.status(400).json({ error: "empty upload" });
    try {
      res.json(req.ws!.importProjectFile(file, new Uint8Array(bytes), name));
    } catch (e) {
      // A refused extension, an occupied name and a file the mapper could not read are all the caller's to fix.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Scaffold a project at the workspace root and return its path — the same scaffold `st0 create` runs.
const createProjectBody = z.object({
  /** The ARCHETYPE — `arrangement`, `mix`, `video` or `live`, the last declaring no surface at all. */
  shape: z.enum(PROJECT_SHAPES),
  name: z.string().min(1),
});
filesRouter.post(
  "/project/create",
  validate(createProjectBody),
  wrap((req, res) => {
    const { shape, name } = req.body as z.infer<typeof createProjectBody>;
    try {
      res.json(req.ws!.createProject(shape, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** Play a document the BROWSER built, so that ONE thing writes to the engine — see docs/fileRoutes.md. */
const engineProjectBody = z.object({ doc: z.looseObject({}) });
filesRouter.post(
  "/engine/project",
  validate(engineProjectBody),
  wrap((req, res) => {
    const { doc } = req.body as { doc: ProjectDoc };
    applyClientProject(req.ws!, doc);
    res.json({ ok: true });
  }),
);

// Quitting: stop and flush the engine and forget the active project, for THIS workspace's session only.
filesRouter.post(
  "/engine/unload",
  wrap(async (req, res) => {
    await unloadEngine(req.ws!);
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
    res.json(
      webCompletions(
        req.ws!,
        String(req.query.line ?? ""),
        req.query.labels === "1",
      ),
    ),
  ),
);
// `at` is a folder the verbs act on INSTEAD of the open project, `want` names the views the caller will DRAW.
const cmdBody = z.object({
  line: z.string(),
  at: z.string().optional(),
  want: z.array(z.enum(["graph"])).optional(),
});
/** Run a verb, and hand back the new graph, `rev` and `changed` with it — see docs/fileRoutes.md. */
filesRouter.post(
  "/command",
  validate(cmdBody),
  wrap(async (req, res) => {
    const { line, at, want } = req.body as z.infer<typeof cmdBody>;
    // Absent is the default — build it. An empty list is a caller that means no.
    const wantsGraph = !want || want.includes("graph");
    const target = at ? req.ws!.mediaPath(at) : undefined;
    // A verb aimed at a library's chain writes it, so it runs only on that library's bench.
    if (target) req.ws!.assertLibraryWritable(target, "run a command on");
    const t0 = performance.now();
    // The two tokens come OUT of the run, so this route takes no walk of its own — see docs/fileRoutes.md.
    // The graph is built INSIDE the run, under the token it ended on and beside its reload — docs/fileRoutes.md.
    const {
      output,
      before,
      after: rev,
      files,
      graph,
      ranAt,
    } = await runWebCommand(req.ws!, line, req.userEmail, target, {
      graph: wantsGraph,
    });
    // The project MOVED — "something", where `changed` on the reply below is "these files".
    const moved = rev !== before;
    // One line per WRITING command, in the shape the engine's `[applyFull]` uses — see docs/fileRoutes.md.
    if (moved)
      console.log(
        `[cmd] ${line.trim().slice(0, 60)} — ran=${(ranAt - t0).toFixed(0)}ms graph=${
          wantsGraph ? `${(performance.now() - ranAt).toFixed(0)}ms` : "skipped"
        }`,
      );
    // `refused` — understood and declined, which is neither "it ran" nor "it threw"; sent only when true.
    res.json({
      output,
      ...(output.refused ? { refused: true } : {}),
      ...(moved ? { rev, revBefore: before } : {}),
      ...(files ? { changed: files } : {}),
      ...(graph ? { graph } : {}),
    });
  }),
);

// --- undo/redo journal ---------------------------------------------------------

// Peek without applying, so the client can enable Ctrl+Z/Y and label its toast.
filesRouter.get(
  "/history",
  wrap((req, res) => res.json(req.ws!.historyState())),
);
// The History panel's list: the journal, oldest first — docs/history.md.
filesRouter.get(
  "/history/entries",
  wrap((req, res) => res.json(req.ws!.historyList())),
);
// Without `confirm` a process step reports `needsConfirm` and is NOT applied, since it restores a bounced file.
const undoBody = z.object({ confirm: z.boolean().optional() });
for (const dir of ["undo", "redo"] as const) {
  filesRouter.post(
    `/${dir}`,
    validate(undoBody),
    wrap(async (req, res) => {
      const { confirm } = req.body as z.infer<typeof undoBody>;
      const next = dir === "undo" ? req.ws!.peekUndo() : req.ws!.peekRedo();
      if (!next) {
        res.json({ applied: false });
        return;
      }
      if (next.kind === "process" && !confirm) {
        res.json({ needsConfirm: true, ...next });
        return;
      }
      // Throws, having written nothing, when the step's audio is kept by another engine — docs/history.md.
      const done =
        dir === "undo"
          ? await req.ws!.undoHistory()
          : await req.ws!.redoHistory();
      // The step rewrote the open project's files, and only a push tells the engine — as `PUT /file` does (docs/history.md).
      if (done) startEngineForActive(req.ws!);
      res.json(done ? { applied: true, ...done } : { applied: false });
    }),
  );
}

// Render the mixdown and stream it. A throw before any bytes becomes a clean 400; after headers, only a log.
filesRouter.get(
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

/** Freeze this project and send it to pl8; no body, and slow because it is a full render (docs/shareBundle.md). */
filesRouter.post(
  "/share/link",
  wrap(async (req, res) => {
    try {
      res.json({ ok: true, ...(await req.ws!.shareLink(req.userEmail!)) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
  "/project",
  wrap((req, res) => res.json(req.ws!.projectInfo())),
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

/** The same folder read as PICTURE — the `WebVideoProject` the viewport draws — see docs/fileRoutes.md. */
filesRouter.get(
  "/video-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.videoProjectDoc());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
  "/video-errors",
  wrap((req, res) => res.json(req.ws!.videoProjectErrors())),
);

/** The compiled `ProjectDoc` — what the ENGINE is given, not the shape a timeline draws (docs/fileRoutes.md). */
filesRouter.get(
  "/engine-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.engineDoc());
    } catch (e) {
      // A project that will not compile: the message is the compiler's own, and the caller shows it.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
filesRouter.get(
  "/graph",
  wrap((req, res) => {
    try {
      // `?at=<rel>` asks for a folder other than the open project — a library chain, through safePath.
      const at = String(req.query.at ?? "");
      res.json(req.ws!.graphDoc(at ? req.ws!.mediaPath(at) : undefined));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
// The project's `surfaces/` folder, parsed — a DERIVED view like /graph, always 200 (docs/fileRoutes.md).
filesRouter.get(
  "/surfaces",
  wrap((req, res) => res.json(req.ws!.surfaces())),
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
// What live sync captured in this workspace, newest last; 404 while it is off (docs/liveCapture.md).
filesRouter.get(
  "/sync/log",
  wrap((req, res) => {
    const n = Math.min(Number(req.query.n) || 50, 500);
    const batches = liveLogTail(req.ws!, n);
    if (!batches) res.status(404).json({ error: "live sync is off" });
    else res.json({ batches });
  }),
);
// Edits the relay set aside because the value had moved meanwhile, each with the value kept (docs/liveCapture.md).
filesRouter.get(
  "/sync/conflicts",
  wrap((req, res) => {
    const conflicts = liveConflicts(req.ws!);
    if (!conflicts) res.status(404).json({ error: "not linked to a relay" });
    else res.json({ conflicts });
  }),
);
// Settle one: `take: true` writes the alternative over the value in place; either way it closes everywhere.
filesRouter.post(
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
filesRouter.get(
  "/tree",
  wrap((req, res) => res.json(req.ws!.tree())),
);
// The whole workspace, not the open project — st0's home page looking inside a repository (docs/fileRoutes.md).
filesRouter.get(
  "/workspace-tree",
  wrap((req, res) => res.json(req.ws!.workspaceTree())),
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
// The declared inputs and outputs (modules under an io/ folder); the LEVELS come from the engine socket, not here.
filesRouter.get(
  "/io-ports",
  wrap((req, res) => res.json(req.ws!.ioPorts())),
);
// The shared `_modules` catalogue — the module builder's list, which it then edits through /file.
filesRouter.get(
  "/module-catalogue",
  wrap((req, res) => res.json(req.ws!.moduleCatalogue())),
);

// --- user presets ----------------------------------------------------------

// A NODE's presets, keyed by the module it extends — applying, saving and updating are `node preset` verbs.
filesRouter.get(
  "/presets",
  wrap((req, res) => {
    const node = String(req.query.node ?? "");
    if (!node) {
      res.status(400).json({ error: "node required" });
      return;
    }
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    try {
      res.json(listNodePresets(dir, node));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** The named bases a module may be set to — its own `base/` and every ancestor's, nearest first. */
filesRouter.get(
  "/module-base",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      res.json({ bases: req.ws!.moduleBases(path) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** Snapshot the ORPHAN plugin's opaque state into the module's `base/` folder — see docs/fileRoutes.md. */
const snapshotBaseBody = z.object({
  /** The module file being edited. The FOLDER comes from it here — the builder never builds a path. */
  path: z.string().min(1),
  name: z.string().min(1),
  /** `@engine/<slug>`: which plugin's orphan to read — the module's own `extends:`. */
  ref: z.string().min(1),
});
filesRouter.post(
  "/module-base/snapshot",
  validate(snapshotBaseBody),
  wrap(async (req, res) => {
    const { path, name, ref } = req.body as z.infer<typeof snapshotBaseBody>;
    const plugin = resolvePlugin(ref, "", "");
    if ("error" in plugin) {
      res.status(plugin.status).json({ error: plugin.error });
      return;
    }
    let where: { abs: string; path: string };
    try {
      where = req.ws!.baseSnapshotPath(path, name);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const wrote = await snapshotPluginBase(plugin.format, plugin.id, where.abs);
    if (wrote === undefined) {
      res
        .status(503)
        .json({ error: "the engine did not answer — is it running?" });
      return;
    }
    if (!wrote.ok) {
      res.status(409).json({
        error:
          "nothing to snapshot — open the plugin's window with « Native UI » and set it up first",
      });
      return;
    }
    res.json({ path: where.path });
  }),
);

filesRouter.post(
  "/waveforms/prewarm",
  wrap((req, res) => {
    // Fire-and-forget, so `wrap` cannot see it: it only catches what the handler RETURNS.
    guard("waveform prewarm", req.ws!.prewarmWaveforms());
    res.json(req.ws!.waveformStatus());
  }),
);
filesRouter.get(
  "/waveforms/status",
  wrap((req, res) => res.json(req.ws!.waveformStatus())),
);
// Give the machine back: the decode batch runs a SECOND engine process, and a playing surface wants those cores.
filesRouter.post(
  "/waveforms/cancel",
  wrap((req, res) => {
    req.ws!.cancelPrewarm();
    res.json(req.ws!.waveformStatus());
  }),
);
filesRouter.post(
  "/waveforms/clear",
  wrap((req, res) => {
    const removed = req.ws!.clearWaveformCache();
    res.json({ ok: true, removed });
  }),
);
// The Logs panel's two halves: the bound engine machine's `.studio.log` (`?tail=N` seeds, `?offset=X`
// continues) and this service's own lines (`?after=S` continues) — docs/serviceLog.md.
filesRouter.get(
  "/logs",
  wrap(async (req, res) => {
    const num = (v: unknown): number | undefined => {
      const n = Number(v);
      return v != null && Number.isFinite(n) ? n : undefined;
    };
    const offset = num(req.query.offset);
    const tail = Math.max(1, Math.min(2000, Number(req.query.tail) || 300));
    res.json({
      ...(await boundMachineLog({ offset, tail })),
      service: serviceLogSince(num(req.query.after), tail),
    });
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
    // `sensitivity` re-detects the transients at that threshold and REMEMBERS it — see docs/fileRoutes.md.
    const raw = Number(req.query.sensitivity);
    const sensitivity = Number.isFinite(raw)
      ? Math.max(0.25, Math.min(8, raw))
      : undefined;
    try {
      res.json(await req.ws!.waveform(clip, buckets, whole, sensitivity));
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
      enginePreview(req.ws ?? null, file, start, length);
      // The window that was actually SENT, so the caller never resolves it twice — see docs/fileRoutes.md.
      res.json({ ok: true, start, length });
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
  wrap(async (req, res) => {
    const { path, content } = req.body as z.infer<typeof writeBody>;
    try {
      // `forked` says the save landed on a project-local copy of a shared module — see docs/fileRoutes.md.
      const r = await req.ws!.recordChange(`édition ${path}`, () =>
        req.ws!.write(path, content),
      );
      // TWO gates — the token moved AND the path is inside the open song — before the engine is pushed to.
      const active = req.ws!.activeProjectPath();
      const abs = resolve(req.ws!.root, path);
      if (
        r.after !== r.before &&
        active &&
        (abs === active || abs.startsWith(active + sep))
      )
        startEngineForActive(req.ws!);
      // `.value` because a journalled mutation also answers with the tokens either side of it.
      res.json({ ok: true, ...r.value });
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

// The `ui.yaml` beside a module file; `path` may name either of the pair, so any click opens the same builder.
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

// The console systems the project may run, for the settings' Project tab — packages/song/docs/console.md.
filesRouter.get(
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
filesRouter.get(
  "/module-engines",
  wrap((req, res) => {
    try {
      res.json(req.ws!.moduleEngines(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Give an engine module a folder in the project, so it can carry a panel; POST because it writes.
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

const fmtBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/fmt",
  validate(fmtBody),
  wrap((req, res) => {
    res.json(req.ws!.fmt((req.body as z.infer<typeof fmtBody>).path));
  }),
);
