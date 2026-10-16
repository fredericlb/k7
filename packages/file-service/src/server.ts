// server.ts — the file service: one account's workspaces and every file op on them, run by the
// SERVER's file hub, one process per account (packages/file-hub/docs/fileHub.md). Loopback only,
// gated by the hub's secret. Drives whichever engine the hub binds it to, through that engine's
// tunnel; engines' machines run no file service. Run under tsx to import the brain's TS.

import { existsSync, mkdirSync } from "node:fs";
import { validate, wrap } from "@frediverse/http/route";
import { coldChains } from "@studio/audio-passes/processChain";
import {
  scannedPluginNames,
  scannedPlugins,
} from "@studio/engine-client/pluginCache";
// k7's plugin contributions — commands and surface types — before anything reads a catalogue
// or compiles a song. The LIST is the plugins package's; this process only calls the install.
import { installBuiltinPlugins } from "@studio/k7-plugins/server";
import { ensureLayout } from "@studio/mediatek/layout";
import {
  loadPreferences,
  setInstrumentalChain,
  setStemsChain,
} from "@studio/song/preferences";
import { accountLibraries } from "@studio/song/sharedFolders";
import {
  type AccountLibrariesReply,
  type AccountWorkspaceList,
  ADMIN_HEADER,
  type ColdChainsReply,
  HUB_SECRET_HEADER,
  type ServedProjectReply,
  type SurfacedProjectList,
  type WorkspaceList,
} from "@studio/web-protocol";
import { isBenchProject } from "@studio/web-protocol/projects";
import express, { type Response } from "express";
import { z } from "zod";
import { installProcessNet } from "./background.ts";
import { benchDir, ensureBench } from "./bench.ts";
import { liveChains } from "./benchChain.ts";
import { boundJobsUrl } from "./boundMachine.ts";
import { resolveUser, resolveWorkspace } from "./context.ts";
import { copyProjectBetween } from "./copyProject.ts";
import { syncExamples } from "./demos.ts";
import {
  pluginParams,
  pruneIdleLinks,
  servedProject,
  showNativePluginUIOf,
  unloadEngineIfServing,
} from "./engineLink.ts";
import { hubRouter, hubSecretOk, requireHubSecret } from "./hosted.ts";
import { ensureLibraryPins } from "./libraryPins.ts";
import { startCopy, startMove } from "./liveMove.ts";
import {
  downloadWorkspace,
  joinServerRooms,
  workspaceSyncStatus,
} from "./liveSync.ts";
import { startPrefetch } from "./mediatekPrefetch.ts";
import { modelDownload, startModelDownload } from "./modelDownloads.ts";
import { installModuleWatch } from "./moduleWatch.ts";
import { adoptRecordedOwner, workspaceGate } from "./owner.ts";
import { resolvePlugin } from "./pluginRef.ts";
import { filesRouter } from "./routes/files.ts";
import { mediatekRouter } from "./routes/mediatek.ts";
import { renderRouter } from "./routes/render.ts";
import { installServiceLog } from "./serviceLog.ts";
import { exitOnSignals } from "./shutdown.ts";
import { rootDir, workspaceRoot } from "./slug.ts";
import {
  attachAllWorkspaces,
  createWorkspace,
  getWorkspace,
  listMachineWorkspaces,
  listSurfacedProjects,
  listWorkspaces,
  removeWorkspace,
  UnknownWorkspaceError,
  workspaceNames,
} from "./workspaces.ts";

// First, so every line this process writes from here on is also the Logs panel's (docs/serviceLog.md).
installServiceLog();

installBuiltinPlugins();

// First and only here: one process holds the socket, the clock and the watcher — see background.ts.
installProcessNet();

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);

const app = express();

app.use(express.json({ limit: "8mb" }));

// --- Routes that can't send custom headers, mounted OUTSIDE the header gates ---

// Media for <video>: identity rides in the QUERY, and the hub stamps its secret on the request as on any other.
app.get(
  "/media",
  wrap((req, res) => {
    const user = String(req.query.user ?? "");
    const workspace = String(req.query.workspace ?? "");
    const path = String(req.query.path ?? "");
    if (!hubSecretOk(req.get(HUB_SECRET_HEADER))) {
      res.status(401).json({ error: "not from this service's file hub" });
      return;
    }
    if (!user || !workspace || !path) {
      res.status(400).json({ error: "user, workspace and path required" });
      return;
    }
    let abs: string;
    try {
      abs = getWorkspace(user, workspace).mediaPath(path);
    } catch (e) {
      res
        .status(e instanceof UnknownWorkspaceError ? 404 : 400)
        .json({ error: (e as Error).message });
      return;
    }
    res.sendFile(abs, (err) => {
      if (!err || res.headersSent) return;
      const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (err as Error).message });
    });
  }),
);

// Liveness, ungated and deliberately EMPTY — the answer IS the payload; the hub waits on it at start.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- Everything below is header-gated: the hub's secret + identity ---
app.use(requireHubSecret);
app.use(hubRouter());
app.use(resolveUser);
// Workspaces are ONE account's, recorded on first use — docs/owner.md.
app.use(["/workspaces", "/engine/served", "/account"], workspaceGate);

// Registered BEFORE resolveWorkspace, and typed by the envelope web-protocol already declares for it.
app.get(
  "/workspaces",
  wrap(async (req, res) => {
    // On a server, a workspace a device created or moved here is joined before it is listed (docs/workspaces.md).
    await joinServerRooms();
    const reply: WorkspaceList = { workspaces: listWorkspaces(req.userEmail!) };
    res.json(reply);
  }),
);
/**
 * A workspace is not made before the account HAS a library. Every `@<library>/…` a
 * project extends resolves through one, and a workspace made without any opens onto references
 * that resolve to nothing — see docs/libraries.md.
 */
const NO_LIBRARIES = "no libraries — an admin adds them in k7's Libraries page";
const hasLibraries = (res: Response): boolean => {
  if (accountLibraries().length) return true;
  res.status(400).json({ error: NO_LIBRARIES });
  return false;
};

const newWsBody = z.object({ name: z.string().min(1) });
app.post(
  "/workspaces",
  validate(newWsBody),
  wrap(async (req, res) => {
    const { name } = req.body as z.infer<typeof newWsBody>;
    if (!hasLibraries(res)) return;
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
app.post(
  "/workspaces/remove",
  validate(removeWorkspaceBody),
  wrap(async (req, res) => {
    const { name } = req.body as z.infer<typeof removeWorkspaceBody>;
    try {
      // The engine first: a project of this workspace still loaded holds files open, and on
      // Windows that answers EPERM half-way through — see workspaces.ts.
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
app.post(
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
app.get(
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
app.get(
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
app.post(
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
app.post(
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
app.post(
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
app.get(
  "/workspaces/surfaces",
  wrap(async (req, res) => {
    const reply: SurfacedProjectList = {
      projects: await listSurfacedProjects(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** …and which ONE of those the engine is holding for this person — one per account, docs/activeProject.md. */
app.get(
  "/engine/served",
  wrap(async (req, res) => {
    const reply: ServedProjectReply = {
      project: servedProject(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** The BENCH, made fresh — one live rig, no repository and nothing kept, see docs/workspace.md. */
app.post(
  "/workspaces/bench",
  wrap(async (req, res) => {
    // `isBenchProject` is the one place either end spells which address the bench answers.
    if (!isBenchProject(String(req.body?.project ?? "")))
      return res.status(404).json({
        error:
          "@banc opens one live rig, and nothing else. A shared MODULE or a CHAIN is edited from a project you already have open — its Libraries tab.",
      });
    if (!hasLibraries(res)) return;
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

// The media library is per MACHINE: the user for the gate, and no workspace.
app.use(mediatekRouter);

// An offline bounce for a hosted backend that cannot exec anything itself — docs/render.md.
app.use(renderRouter);

// What this machine's engine has SCANNED, in the two shapes both used — see docs/activeProject.md.
app.get(
  "/plugins",
  wrap((_req, res) =>
    res.json({ pluginNames: scannedPluginNames(), plugins: scannedPlugins() }),
  ),
);

/** …and what ONE of them HAS — a plugin LOADED and asked, which takes seconds. See docs/activeProject.md. */
app.get(
  "/plugin-params",
  wrap(async (req, res) => {
    const found = resolvePlugin(
      String(req.query.ref ?? ""),
      String(req.query.format ?? ""),
      String(req.query.id ?? ""),
    );
    if ("error" in found) {
      res.status(found.status).json({ error: found.error });
      return;
    }
    const { format, id } = found;
    const answer = await pluginParams(format, id);
    if (answer === undefined) {
      res
        .status(503)
        .json({ error: "the engine did not answer — is it running?" });
      return;
    }
    res.json(answer);
  }),
);

/** …and what one LOOKS LIKE — an ORPHAN instance's own window, on this machine. See docs/activeProject.md. */
app.get(
  "/plugin-native-ui",
  wrap(async (req, res) => {
    const found = resolvePlugin(
      String(req.query.ref ?? ""),
      String(req.query.format ?? ""),
      String(req.query.id ?? ""),
    );
    if ("error" in found) {
      res.status(found.status).json({ error: found.error });
      return;
    }
    const opened = await showNativePluginUIOf(found.format, found.id);
    if (opened === undefined) {
      res.status(504).json({
        error:
          "the engine never said it opened one — it may be busy loading the plugin, or its offline engine may be wedged (the parameter scan hangs the same way)",
      });
      return;
    }
    if (!opened.ok) {
      res.status(502).json({
        error: `the engine could not open a window for ${found.id} — see its log`,
      });
      return;
    }
    res.json({ opened: found.id });
  }),
);

/**
 * WHICH chains this machine separates a record with and makes an instrumental with — standing
 * answers for the machine, so they are k7's GLOBAL settings and answered before
 * `resolveWorkspace`, like the libraries: no project is open when they are set. The choice is
 * from the libraries' COLD chains (`coldChains`). See docs/libraries.md.
 */
const coldChainsView = (): ColdChainsReply => {
  const prefs = loadPreferences();
  return {
    // No library cloned, no chains — the ordinary state of a new machine, and an empty list.
    chains: coldChains(benchDir()),
    stemsChain: prefs.stemsChain ?? null,
    instrumentalChain: prefs.instrumentalChain ?? null,
  };
};

/** The libraries' chains and whether each can be PLAYED live on the bench — k7's chain source. */
app.get(
  "/account/live-chains",
  wrap((_req, res) => {
    res.json({ chains: liveChains(benchDir()) });
  }),
);

app.get(
  "/account/cold-chains",
  wrap((_req, res) => {
    res.json(coldChainsView());
  }),
);

app.put(
  "/account/cold-chains/:which",
  wrap((req, res) => {
    const which = req.params.which;
    if (which !== "stems" && which !== "instrumental")
      return res.status(404).json({ error: `no '${which}' chain setting` });
    const ref = String((req.body as { ref?: unknown })?.ref ?? "").trim();
    // Empty CLEARS it — "this machine does not do that" is a real answer, not a missing one.
    if (ref) {
      const chain = coldChainsView().chains.find((c) => c.ref === ref);
      if (!chain)
        return res
          .status(400)
          .json({ error: `'${ref}' is not a cold chain of the library` });
      // Stricter for the instrumental, as `system instrumental` is: four stems is not one.
      if (which === "instrumental" && !chain.instrumental)
        return res
          .status(400)
          .json({ error: `'${ref}' writes no instrumental` });
    }
    if (which === "stems") setStemsChain(ref);
    else setInstrumentalChain(ref);
    res.json(coldChainsView());
  }),
);

/**
 * Download the models a cold chain needs and this machine has not got — the settings' "Download
 * model" link. What is fetched, and from where, is read off the chain's own modules (`model_url`),
 * never taken from the caller. Answers one job per model, polled below.
 */
app.post(
  "/account/cold-chains/download",
  wrap((req, res) => {
    const ref = String((req.body as { ref?: unknown })?.ref ?? "").trim();
    const chain = coldChainsView().chains.find((c) => c.ref === ref);
    if (!chain)
      return res
        .status(404)
        .json({ error: `'${ref}' is not a cold chain of the library` });
    if (!chain.downloads.length)
      return res.status(400).json({
        error: `'${ref}' needs no model this machine can download`,
      });
    res.json({
      jobs: chain.downloads.map((d) => startModelDownload(d.file, d.url)),
    });
  }),
);

/** One model download, as it stands — account-level, so both the settings and a project poll it here. */
app.get(
  "/account/models/:id",
  wrap((req, res) => {
    const job = modelDownload(req.params.id);
    if (!job) return res.status(404).json({ error: "no such download" });
    res.json(job);
  }),
);

// No cut route here: pl8 drives a separation and posts the bytes — see docs/processChain.md.

// Everything else needs a resolved workspace on req.ws, and is its owner's alone.
app.use(workspaceGate, resolveWorkspace, filesRouter);

// Loopback: its only caller is the hub beside it.
const HOST = "127.0.0.1";
const server = app.listen(FILE_PORT, HOST, () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.k7/root exists
  // The engine session is the recorded owner's from the first frame, not from the first request.
  adoptRecordedOwner();
  // Only a long-lived process may skip `@studio/song`'s module-stamp walk — see moduleWatch.ts.
  installModuleWatch();
  // Same for the media library, tolerated rather than required: its root may be an unmounted drive.
  try {
    console.log(`   mediatek: ${ensureLayout()}`);
  } catch (e) {
    console.warn(`   mediatek unavailable: ${(e as Error).message}`);
  }
  console.log(`📁 k7 file service on http://${HOST}:${FILE_PORT}`);
  console.log(`   root: ${rootDir()}`);
  // Examples stocked with this build's demos: a new account's first sight of k7, an old one's fixes.
  syncExamples();
  // Every workspace is a replica from the start, so one never opened here still sends and receives.
  attachAllWorkspaces();
  // The songs the open projects name, onto the bound engine's machine ahead of the gig.
  startPrefetch(boundJobsUrl);
  // Reap engine sockets nobody has used in minutes — an abandoned link re-dials forever, see pruneIdleLinks.
  setInterval(() => {
    for (const s of pruneIdleLinks())
      console.log(`   engine link idle, dropped: ${s}`);
  }, 60_000).unref();
});
// A quit or a redeploy stops this process by signal: it stops accepting and exits 0 (docs/shutdown.md).
exitOnSignals(server);
