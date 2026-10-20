// workspacesRoutes.ts — the account's workspaces as a whole: list, create, remove, copy a project
// between them, the sync servers they live on, the bench. Mounted by server.ts BEFORE
// resolveWorkspace, since none of these is about one open workspace. See docs/workspaces.md.

import { validate, wrap } from "@frediverse/http/route";
import {
  type AccountWorkspaceList,
  ADMIN_HEADER,
  type ServedProjectReply,
  type SurfacedProjectList,
  type WorkspaceList,
} from "@studio/web-protocol";
import { isBenchProject } from "@studio/web-protocol/projects";
import { type Response, Router } from "express";
import { z } from "zod";
import { ensureBench } from "../bench.ts";
import { copyProjectBetween } from "../copyProject.ts";
import { servedProject, unloadEngineIfServing } from "../engineLink.ts";
import { libraryRefusal } from "../libraries.ts";
import { ensureLibraryPins } from "../libraryPins.ts";
import { startCopy, startMove } from "../liveMove.ts";
import {
  downloadWorkspace,
  joinServerRooms,
  workspaceSyncStatus,
} from "../liveSync.ts";
import { rootDir, workspaceRoot } from "../slug.ts";
import {
  createWorkspace,
  listMachineWorkspaces,
  listSurfacedProjects,
  listWorkspaces,
  removeWorkspace,
  UnknownWorkspaceError,
  workspaceNames,
} from "../workspaces.ts";
export const workspacesRouter: Router = Router();

// Registered BEFORE resolveWorkspace, and typed by the envelope web-protocol already declares for it.
workspacesRouter.get(
  "/workspaces",
  wrap(async (req, res) => {
    // On a server, a workspace a device created or moved here is joined before it is listed (docs/workspaces.md).
    await joinServerRooms();
    const reply: WorkspaceList = { workspaces: listWorkspaces(req.userEmail!) };
    res.json(reply);
  }),
);
/** No workspace before a library: its `@<library>/…` refs would resolve to nothing — docs/libraries.md. */
const hasLibraries = async (res: Response): Promise<boolean> => {
  const refused = await libraryRefusal();
  if (refused) res.status(refused.status).json({ error: refused.error });
  return !refused;
};

const newWsBody = z.object({ name: z.string().min(1) });
workspacesRouter.post(
  "/workspaces",
  validate(newWsBody),
  wrap(async (req, res) => {
    const { name } = req.body as z.infer<typeof newWsBody>;
    if (!(await hasLibraries(res))) return;
    // The ONE place a workspace is created on request — getWorkspace deliberately refuses to (Examples aside).
    try {
      const created = await createWorkspace(req.userEmail!, name);
      // A new workspace pins the newest version of each library this k7 runs.
      if (created)
        ensureLibraryPins(workspaceRoot(name), {
          fresh: true,
          admin: req.get(ADMIN_HEADER) === "1",
        });
      res.json({ created });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** Remove a workspace: it names the one it destroys, so it sits before the workspace gate. */
const removeWorkspaceBody = z.object({ name: z.string().min(1) });
workspacesRouter.post(
  "/workspaces/remove",
  validate(removeWorkspaceBody),
  wrap(async (req, res) => {
    const { name } = req.body as z.infer<typeof removeWorkspaceBody>;
    try {
      // Unload the engine first: a loaded project holds files open, and Windows answers EPERM — docs/workspaces.md.
      await removeWorkspace(req.userEmail!, name, (abs) =>
        unloadEngineIfServing(abs),
      );
      res.json({ ok: true });
    } catch (e) {
      // A bad name and an absent workspace are both the caller's to fix.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** Copy a project into ANOTHER workspace: it names two, so it sits before the workspace gate. */
const copyProjectBody = z.object({
  from: z.string().min(1),
  path: z.string().min(1),
  to: z.string().min(1),
  name: z.string().min(1),
});
workspacesRouter.post(
  "/workspaces/copy-project",
  validate(copyProjectBody),
  wrap(async (req, res) => {
    const { from, path, to, name } = req.body as z.infer<
      typeof copyProjectBody
    >;
    try {
      res.json(await copyProjectBetween(req.userEmail!, from, path, to, name));
    } catch (e) {
      // A workspace that is gone sends the page back to the list; a refused name is the dialog's to fix.
      const code = e instanceof UnknownWorkspaceError ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

/** Every workspace on this machine and the projects in it — k7's home page, in one call. See docs/activeProject.md. */
workspacesRouter.get(
  "/workspaces/projects",
  wrap(async (req, res) => {
    await joinServerRooms();
    const reply: AccountWorkspaceList = {
      workspaces: await listMachineWorkspaces(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** Where each workspace lives on a machine paired with a remote server: both, here only, or there only. See docs/workspaces.md. */
workspacesRouter.get(
  "/workspaces/sync",
  wrap(async (_req, res) => {
    res.json(await workspaceSyncStatus(workspaceNames(rootDir())));
  }),
);

/** Bring a workspace that exists only on a server down here — the main one unless `server` says — and keep it synced. */
const downloadBody = z.object({
  name: z.string().min(1),
  server: z.string().min(1).optional(),
});
workspacesRouter.post(
  "/workspaces/sync/download",
  validate(downloadBody),
  wrap(async (req, res) => {
    const { name, server } = req.body as z.infer<typeof downloadBody>;
    const here = new Set(workspaceNames(rootDir()));
    // A name another server's workspace already has here lands as `name.host` (docs/liveCapture.md, "Several servers").
    const local = await downloadWorkspace(name, server, (n) => here.has(n));
    if (local) res.json({ ok: true, name: local });
    else
      res.status(404).json({
        error: `${server ?? "the server"} has no workspace '${name}'`,
      });
  }),
);

/** Move a workspace to another server this account is paired with: there whole, then off the one it left. */
const moveBody = z.object({
  name: z.string().min(1),
  to: z.string().min(1),
});
workspacesRouter.post(
  "/workspaces/sync/move",
  validate(moveBody),
  wrap(async (req, res) => {
    const { name, to } = req.body as z.infer<typeof moveBody>;
    try {
      // The refusals answered now; the move itself runs on, and `/workspaces/sync` says how it went.
      await startMove(workspaceRoot(name), to);
      res.status(202).json({ ok: true });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

/** Copy a workspace to another server this account is paired with: there whole, and still synced where it was. */
workspacesRouter.post(
  "/workspaces/sync/copy",
  validate(moveBody),
  wrap(async (req, res) => {
    const { name, to } = req.body as z.infer<typeof moveBody>;
    try {
      // Answered like a move: the refusals now, the copy running on, and `/workspaces/sync` says how it went.
      await startCopy(workspaceRoot(name), to);
      res.status(202).json({ ok: true });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

/** …the same list narrowed to what a SECOND DEVICE could open — k7's `/external`, in one call. */
workspacesRouter.get(
  "/workspaces/surfaces",
  wrap(async (req, res) => {
    const reply: SurfacedProjectList = {
      projects: await listSurfacedProjects(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** …and which ONE of those the engine is holding for this person — one per account, docs/activeProject.md. */
workspacesRouter.get(
  "/engine/served",
  wrap(async (req, res) => {
    const reply: ServedProjectReply = {
      project: servedProject(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** The BENCH, made fresh — one live rig, no repository and nothing kept, see docs/workspace.md. */
workspacesRouter.post(
  "/workspaces/bench",
  wrap(async (req, res) => {
    // `isBenchProject` is the one place either end spells which address the bench answers.
    if (!isBenchProject(String(req.body?.project ?? "")))
      return res.status(404).json({
        error:
          "@banc opens one live rig, and nothing else. A shared MODULE or a CHAIN is edited from a project you already have open — its Libraries tab.",
      });
    if (!(await hasLibraries(res))) return;
    const project = String(req.body.project);
    try {
      // A chain's bench is what k7 records through, ../../ui-rehearsal/docs/chainSource.md.
      res.json(await ensureBench(req.userEmail!, project));
    } catch (e) {
      // A library that will not mount is the USER's problem to read, so it is a 409 and not a fault.
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);
