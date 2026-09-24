import { isSshGitUri, repoName } from "@studio/git-repos/uri";
// server.ts — the engine-side file service: owns ~/.st0/root/<user>/<workspace>
// and serves every file op to the browser DIRECTLY (cross-origin, hence CORS). Dials
// the LOCAL C++ engine to compile-and-send; the browser drives transport itself.
// Spawned by the engine-host supervisor, run under tsx to import the brain's TS.

import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { validate, wrap } from "@frediverse/http/route";
import { coldChains } from "@studio/audio-passes/processChain";
import {
  scannedPluginNames,
  scannedPlugins,
} from "@studio/engine-client/pluginCache";
import { ensureLayout } from "@studio/mediatek/layout";
import { configureMpv } from "@studio/mpv-player/player";
import { createPlayerRouter } from "@studio/mpv-player/router";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import {
  loadPreferences,
  setInstrumentalChain,
  setStemsChain,
} from "@studio/song/preferences";
// st0's plugin contributions — commands and surface types — before anything reads a catalogue
// or compiles a song. The LIST is the plugins package's; this process only calls the install.
import { installBuiltinPlugins } from "@studio/st0-plugins/server";
import {
  type ColdChainsReply,
  HUB_SECRET_HEADER,
  type MachineWorkspaceList,
  type ServedProjectReply,
  type SurfacedProjectList,
  type WorkspaceList,
} from "@studio/web-protocol";
import { BENCH_PROJECT, isBenchProject } from "@studio/web-protocol/projects";
import cors from "cors";
import express, { type Response } from "express";
import { z } from "zod";
import { installProcessNet } from "./background.ts";
import { BENCH_WORKSPACE, ensureBench, ensureBenchLibraries } from "./bench.ts";
import { cloneJob, startClone } from "./cloneJobs.ts";
import {
  engineTokenState,
  requireEngineToken,
  resolveUser,
  resolveWorkspace,
} from "./context.ts";
import { copyProjectBetween } from "./copyProject.ts";
import { allowedOrigin, originPolicySummary } from "./cors.ts";
import { syncAllRepos } from "./demos.ts";
import {
  pluginParams,
  pruneIdleLinks,
  servedProject,
  setSelectedEngine,
  showNativePluginUIOf,
  unloadEngineIfServing,
} from "./engineLink.ts";
import { HOSTED, hubRouter, hubSecretOk, requireHubSecret } from "./hosted.ts";
import { librariesUri, setLibrariesUri } from "./libraries.ts";
import { startMediatekPuller } from "./mediatekPull.ts";
import { modelDownload, startModelDownload } from "./modelDownloads.ts";
import { installModuleWatch } from "./moduleWatch.ts";
import { adoptRecordedOwner, requireRootOwner } from "./owner.ts";
import { record as recordRefusedOrigin } from "./pendingOrigins.ts";
import { resolvePlugin } from "./pluginRef.ts";
import { filesRouter } from "./routes/files.ts";
import { mediatekRouter } from "./routes/mediatek.ts";
import { processRouter } from "./routes/process.ts";
import { renderRouter } from "./routes/render.ts";
import { separateRouter } from "./routes/separate.ts";
import { syncRouter } from "./routes/sync.ts";
import { rootDir, workspaceRoot } from "./slug.ts";
import { createKeyFor, publicKeyFor } from "./sshKeys.ts";
import {
  assertSshGitUri,
  createWorkspace,
  getWorkspace,
  listMachineWorkspaces,
  listSurfacedProjects,
  listWorkspaces,
  removeWorkspace,
  setWorkspaceRemote,
  UnknownWorkspaceError,
  workspaceForRepo,
  workspaceNameFor,
} from "./workspaces.ts";

installBuiltinPlugins();

// First and only here: one process holds the socket, the clock and the watcher — see background.ts.
installProcessNet();

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);
const ENGINE_PORT = Number(process.env.STUDIO_ENGINE_PORT || 8765);

// The media this host plays is its CACHE of the médiathèque; a hosted service has no speakers.
if (!HOSTED) configureMpv({ mediaRoot: mediatekRoot, socketDir: rootDir });

const app = express();

// Never reflect an arbitrary origin, and record a refusal for the tray — see docs/corsAndOrigins.md.
// A hosted service is reached through its hub alone, which answers the browser's CORS itself.
if (!HOSTED) {
  app.use(
    cors({
      origin: (o, cb) => {
        const ok = allowedOrigin(o);
        if (!ok) recordRefusedOrigin(o);
        cb(null, ok);
      },
      credentials: false,
    }),
  );
  // Any OPTIONS here was refused above, and running on returns a 401 that lies: a preflight carries no header.
  app.use((req, res, next) => {
    if (req.method !== "OPTIONS") return next();
    res.status(403).json({
      error: "origin not allowed",
      origin: req.get("origin") ?? null,
      hint: "allow it from the tray: Settings… ▸ st0 instances ▸ the blocked origin",
    });
  });
}

app.use(express.json({ limit: "8mb" }));

// Constant-time compare of a query token, with requireEngineToken's three states — docs/corsAndOrigins.md.
function mediaTokenOk(supplied: string): boolean {
  const state = engineTokenState();
  if (state.k === "unreadable") return false;
  if (state.k === "none") return true;
  const expected = state.value;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Routes that can't send custom headers, mounted OUTSIDE the header gates ---

// Media for <video>: identity rides in the QUERY, so this sits outside the gates — docs/corsAndOrigins.md.
app.get(
  "/media",
  wrap((req, res) => {
    const user = String(req.query.user ?? "");
    const workspace = String(req.query.workspace ?? "");
    const path = String(req.query.path ?? "");
    const allowed = HOSTED
      ? hubSecretOk(req.get(HUB_SECRET_HEADER))
      : mediaTokenOk(String(req.query.token ?? ""));
    if (!allowed) {
      res.status(401).json({ error: "bad or missing engine token" });
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

// Liveness, ungated and deliberately EMPTY — the answer IS the payload. See docs/corsAndOrigins.md.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- Everything below is header-gated: engine token (or the hub's secret) + identity ---
app.use(HOSTED ? requireHubSecret : requireEngineToken);
if (HOSTED) app.use(hubRouter());
app.use(resolveUser);
// Workspaces and the account they belong to are ONE account's; the machine's own routes stay open — docs/owner.md.
app.use(
  ["/workspaces", "/engine/served", "/account", "/ssh-key"],
  requireRootOwner,
);

// Registered BEFORE resolveWorkspace, and typed by the envelope web-protocol already declares for it.
app.get(
  "/workspaces",
  wrap((req, res) => {
    const reply: WorkspaceList = { workspaces: listWorkspaces(req.userEmail!) };
    res.json(reply);
  }),
);
/**
 * A workspace is not made or cloned before the account HAS a library. Everything in one resolves
 * `@st0/…` through it, and a workspace made without one opens onto references that resolve to
 * nothing — see docs/libraries.md. The URI is validated by CLONING when it is added, below.
 */
const NO_LIBRARIES =
  "no libraries repository — add one on st0's home page, in the card above the list";
const hasLibraries = (res: Response): boolean => {
  if (librariesUri()) return true;
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
      res.json({ created: await createWorkspace(req.userEmail!, name) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** A local workspace's FIRST repository: the remote, and the push onto it — docs/workspaces.md. */
const remoteBody = z.object({
  name: z.string().min(1),
  uri: z.string().min(1),
});
app.post(
  "/workspaces/remote",
  validate(remoteBody),
  wrap(async (req, res) => {
    const { name, uri } = req.body as z.infer<typeof remoteBody>;
    try {
      await setWorkspaceRemote(req.userEmail!, name, uri);
      res.json({ ok: true });
    } catch (e) {
      // A refused URI, a workspace that already has one, and a push git turned down are all
      // things the caller can act on — and the last one is git's own words. See docs/workspaces.md.
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

/** Every workspace on this machine and the projects in it — st0's home page, in one call. See docs/activeProject.md. */
app.get(
  "/workspaces/projects",
  wrap(async (req, res) => {
    const reply: MachineWorkspaceList = {
      workspaces: await listMachineWorkspaces(req.userEmail!),
    };
    res.json(reply);
  }),
);

/** …the same list narrowed to what a SECOND DEVICE could open — st0's `/external`, in one call. */
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

/** Which workspace already holds a repository, if any — what st0 asks before cloning anything. */
app.get(
  "/workspaces/by-repo",
  wrap(async (req, res) => {
    const uri = String(req.query.uri ?? "");
    try {
      res.json({ workspace: await workspaceForRepo(req.userEmail!, uri) });
    } catch (e) {
      // The only throw is a uri we refuse to hand git — caller-fixable, so 400.
      res.status(400).json({ error: (e as Error).message });
    }
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
    // The account's library repository, from the browser — the side that holds pl8's session.
    const libraries = String(req.body?.libraries ?? "");
    if (!libraries) return res.status(400).json({ error: NO_LIBRARIES });
    try {
      res.json(await ensureBench(req.userEmail!, libraries));
    } catch (e) {
      // A library that will not mount is the USER's problem to read, so it is a 409 and not a fault.
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// Cloning runs HERE, and it STARTS a job to poll rather than holding the request — docs/cloneJobs.md.
const cloneBody = z.object({
  uri: z.string().min(1),
  // Optional: the caller usually has a URI and no opinion about the folder's name.
  name: z.string().min(1).optional(),
});
app.post(
  "/workspaces/clone",
  validate(cloneBody),
  wrap((req, res) => {
    const { name, uri } = req.body as z.infer<typeof cloneBody>;
    if (!hasLibraries(res)) return;
    try {
      assertSshGitUri(uri);
      const workspace = name || workspaceNameFor(uri);
      res.json(startClone(req.userEmail!, workspace, uri));
    } catch (e) {
      // Everything thrown here is caller-fixable — bad URI, no free name — so 400, not 500.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

app.get(
  "/workspaces/clone/:id",
  wrap((req, res) => {
    const job = cloneJob(req.params.id);
    // 404 rather than a synthetic "done": a job this service has forgotten cannot be waited on.
    if (!job) return res.status(404).json({ error: "unknown clone job" });
    res.json(job);
  }),
);

// The media library is per MACHINE: the user for the gate, and no workspace.
app.use(mediatekRouter);

// Play a song on THIS machine's outputs, without the engine and without a project — @studio/mpv-player.
if (!HOSTED) app.use(createPlayerRouter((req) => req.userEmail!));

// An offline bounce for a hosted backend that cannot exec anything itself — docs/render.md.
app.use(renderRouter);

// Stem separation, started and polled because it takes minutes and produces four files — docs/stemSplit.md.
app.use(separateRouter);

// …and the same work for a caller that holds the audio and no cache path — docs/processChain.md.
app.use(processRouter);

// Copying a set list onto a stick or an FTP box: a target belongs to the MACHINE — docs/playlistSync.md.
app.use(syncRouter);

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
 * The deploy key, which is THIS machine's — pl8 knows nothing about git any more. The public
 * half is what gets pasted at a git host; the private half is never served, by anyone, ever.
 *
 * `null` with a 200 and not a 404: "no key yet" is the ordinary state of a machine that has
 * cloned nothing, and the screen has a button for it rather than an error.
 */
/**
 * The account's library repository — the pointer pl8 used to hold, now this machine's. Answered
 * BEFORE `resolveWorkspace`, like the key: the gate asks for it with no workspace chosen yet.
 *
 * `null` with a 200 and not a 404: no library repository is the ordinary state of a new machine,
 * and the gate draws a screen for it rather than an error.
 */
app.get(
  "/account/libraries",
  wrap((_req, res) => {
    const uri = librariesUri();
    res.json({ libraries: uri ? { uri, name: repoName(uri) } : null });
  }),
);

app.put(
  "/account/libraries",
  wrap(async (req, res) => {
    const uri = String((req.body as { uri?: unknown })?.uri ?? "").trim();
    // The servers' own rule, so a paste refused here is refused everywhere.
    if (!isSshGitUri(uri))
      return res
        .status(400)
        .json({ error: `not an SSH git URI: ${uri || "(empty)"}` });
    // CLONED before it is written down: a URI nobody can clone is not a library, and the clone
    // this leaves is the one the bench opens against — docs/libraries.md.
    try {
      await ensureBenchLibraries(req.userEmail!, uri);
    } catch (e) {
      return res
        .status(400)
        .json({ error: `could not clone ${uri} — ${(e as Error).message}` });
    }
    setLibrariesUri(uri);
    res.json({ libraries: { uri, name: repoName(uri) } });
  }),
);

/**
 * WHICH chains this machine separates a record with and makes an instrumental with — standing
 * answers for the machine, so they are st0's GLOBAL settings and answered before
 * `resolveWorkspace`, like the library: no project is open when they are set. The choice is from
 * the library's COLD chains, judged against the bench's clone of it (`coldChains`). See
 * docs/libraries.md.
 */
const coldChainsView = (): ColdChainsReply => {
  const prefs = loadPreferences();
  return {
    // No library, no chains — and no clone to read, which is the ordinary state of a new machine.
    chains: librariesUri()
      ? coldChains(join(workspaceRoot(BENCH_WORKSPACE), BENCH_PROJECT))
      : [],
    stemsChain: prefs.stemsChain ?? null,
    instrumentalChain: prefs.instrumentalChain ?? null,
  };
};

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

app.get(
  "/ssh-key",
  wrap((req, res) => {
    res.json({ publicKey: publicKeyFor(req.userEmail!) });
  }),
);

app.post(
  "/ssh-key",
  wrap(async (req, res) => {
    // Idempotent in `generateKey`: an existing key is answered rather than replaced, or every
    // press would orphan the half already pasted at a git host.
    res.json({ publicKey: await createKeyFor(req.userEmail!) });
  }),
);

// No cut route here: pl8 drives a separation and posts the bytes — see docs/processChain.md.

// Everything else needs a resolved workspace on req.ws, and is its owner's alone.
app.use(requireRootOwner, resolveWorkspace, filesRouter);

/** What only the engine's own machine does at boot: warn when ungated, dial the engine, pull the médiathèque. */
function startOnEngineMachine(): void {
  // Log the effective policy: a bad allowlist otherwise surfaces only as an unexplained browser failure.
  console.log(`   cors: ${originPolicySummary()}`);
  // Out loud when nothing gates the routes: this binds 0.0.0.0, so an open run is open on the LAN.
  const tok = engineTokenState();
  if (tok.k === "none")
    console.warn(
      "   ⚠ no engine identity here — every route is UNAUTHENTICATED (bare dev run)",
    );
  else if (tok.k === "unreadable")
    console.error(`   ✗ engine identity unreadable, refusing all: ${tok.why}`);
  // Dial the local engine so file/command ops can compile-and-send the project.
  setSelectedEngine(`ws://127.0.0.1:${ENGINE_PORT}`);
  // Keep the médiathèque cache in step with the hosted library, for what the open songs name.
  startMediatekPuller();
}

// Loopback when hosted: its only caller is the hub beside it.
const HOST = HOSTED ? "127.0.0.1" : "0.0.0.0";
app.listen(FILE_PORT, HOST, () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.st0/root exists
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
  console.log(
    `📁 st0 file service on http://${HOST}:${FILE_PORT}${HOSTED ? " (hosted)" : ""}`,
  );
  console.log(`   root: ${rootDir()}`);
  // Bring every known repo's Examples level with this build's demos, so a fix reaches existing users unseeded.
  syncAllRepos();
  // Hosted, the engine comes from the hub and the médiathèque is already on this server's disk.
  if (!HOSTED) startOnEngineMachine();
  // Reap engine sockets nobody has used in minutes — an abandoned link re-dials forever, see pruneIdleLinks.
  setInterval(() => {
    for (const s of pruneIdleLinks())
      console.log(`   engine link idle, dropped: ${s}`);
  }, 60_000).unref();
});
