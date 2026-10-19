// entryRoutes.ts — opening, creating, importing, renaming, moving and recycling projects and entries, and
// handing the engine a project.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { validate, wrap } from "@frediverse/http/route";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { PROJECT_SHAPES } from "@studio/song-schema/yaml/projectSchema";
import { ADMIN_HEADER } from "@studio/web-protocol";
import express, { Router } from "express";
import { z } from "zod";
import {
  applyClientProject,
  engineLoadOf,
  startEngineForActive,
  unloadEngine,
  unloadEngineIfServing,
} from "../engineLink.ts";
import { refreshLibraries } from "../libraries.ts";
import { ensureLibraryPins } from "../libraryPins.ts";
import { projectSyncState } from "../liveSync.ts";

export const entryRouter: Router = Router();

/** Open a project — the account's LIBRARIES brought up to date first — see docs/fileRoutes.md. */
const openBody = z.object({
  path: z.string().min(1),
  // Sent by browsers that still hold the old single URI; the file service knows the list itself.
  libraries: z.string().optional(),
});
entryRouter.post(
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
      // `.` names a project only when the workspace folder is one; otherwise the workspace picks — docs/workspaces.md.
      const want = path === "." ? req.ws!.defaultProject() : path;
      // A workspace with no project at all opens as a tree; there is nothing to start.
      if (want) {
        // Not before the relay has brought it all: half a project compiles to "file missing" (docs/liveCapture.md).
        const sync = projectSyncState(req.ws!, want);
        if (!sync.ready) {
          res.status(409).json({ error: `'${want}' is still syncing`, sync });
          return;
        }
        req.ws!.setActiveProject(want);
        startEngineForActive(req.ws!);
      }
      // The load this open just began, so the page holds Play from now rather than from its next poll.
      res.json({
        ...req.ws!.workspaceInfo(),
        engineLoad: engineLoadOf(req.ws ?? null),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Unload the project and recycle its folder, whence it can't be started; a bad or recycled project is a 400.
const deleteProjectBody = z.object({ path: z.string().min(1) });
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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
entryRouter.post(
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

// Add a node beside a module.k7x, which it inherits; `path` is the folder or any file in it.
const nodeBody = z.object({
  path: z.string().min(1),
  // Optional: without one the service names the node `<module>_<n>` — see Workspace.createNode.
  node: z.string().min(1).optional(),
});
entryRouter.post(
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
entryRouter.post(
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

// A project dropped on a workspace: its bytes are translated, never written into the workspace (docs/import.md).
entryRouter.post(
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

// Scaffold a project at the workspace root and return its path — the same scaffold `k7 create` runs.
const createProjectBody = z.object({
  /** The ARCHETYPE — `arrangement`, `mix`, `video` or `live`, the last declaring no surface at all. */
  shape: z.enum(PROJECT_SHAPES),
  name: z.string().min(1),
});
entryRouter.post(
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
entryRouter.post(
  "/engine/project",
  validate(engineProjectBody),
  wrap((req, res) => {
    const { doc } = req.body as { doc: ProjectDoc };
    applyClientProject(req.ws!, doc);
    res.json({ ok: true });
  }),
);

// Quitting: stop and flush the engine and forget the active project, for THIS workspace's session only.
entryRouter.post(
  "/engine/unload",
  wrap(async (req, res) => {
    await unloadEngine(req.ws!);
    res.json({ ok: true });
  }),
);
