// server.ts — the engine-side file service: owns ~/.studio/root/<user>/<workspace>
// and serves every file op to the browser DIRECTLY (cross-origin, hence CORS). Dials
// the LOCAL C++ engine to compile-and-send; the browser drives transport itself.
// Spawned by the engine-host supervisor, run under tsx to import the brain's TS.

import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { validate, wrap } from "@frediverse/http/route";
import {
  scannedPluginNames,
  scannedPlugins,
} from "@studio/engine-client/pluginCache";
import { ensureLayout } from "@studio/mediatek/layout";
import type {
  MachineWorkspaceList,
  ServedProjectReply,
  SurfacedProjectList,
  WorkspaceList,
} from "@studio/web-protocol";
import { benchChainPath } from "@studio/web-protocol/projects";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { installProcessNet } from "./background.ts";
import { ensureChainBench } from "./bench.ts";
import { cloneJob, startClone } from "./cloneJobs.ts";
import {
  engineTokenState,
  requireEngineToken,
  resolveUser,
  resolveWorkspace,
} from "./context.ts";
import { allowedOrigin, originPolicySummary } from "./cors.ts";
import { syncAllRepos } from "./demos.ts";
import {
  pluginParams,
  pruneIdleLinks,
  servedProject,
  setSelectedEngine,
  showNativePluginUIOf,
} from "./engineLink.ts";
import { startMediatekPuller, syncMediatekFamily } from "./mediatekPull.ts";
import { installModuleWatch } from "./moduleWatch.ts";
import { record as recordRefusedOrigin } from "./pendingOrigins.ts";
import { resolvePlugin } from "./pluginRef.ts";
import { filesRouter } from "./routes/files.ts";
import { mediatekRouter } from "./routes/mediatek.ts";
import { playerRouter } from "./routes/player.ts";
import { processRouter } from "./routes/process.ts";
import { renderRouter } from "./routes/render.ts";
import { separateRouter } from "./routes/separate.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import {
  assertSshGitUri,
  createWorkspace,
  getWorkspace,
  listMachineWorkspaces,
  listSurfacedProjects,
  listWorkspaces,
  UnknownWorkspaceError,
  workspaceForRepo,
  workspaceNameFor,
} from "./workspaces.ts";

// First and only here: one process holds the socket, the clock and the watcher — see background.ts.
installProcessNet();

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);
const ENGINE_PORT = Number(process.env.STUDIO_ENGINE_PORT || 8765);

const app = express();

// Never reflect an arbitrary origin, and record a refusal for the tray — see docs/corsAndOrigins.md.
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
    hint: "allow it from the tray: Web UI ▸ the blocked origin",
  });
});

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
    if (!mediaTokenOk(String(req.query.token ?? ""))) {
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

// --- Everything below is header-gated: engine token + identity ---
app.use(requireEngineToken);
app.use(resolveUser);

// Registered BEFORE resolveWorkspace, and typed by the envelope web-protocol already declares for it.
app.get(
  "/workspaces",
  wrap((req, res) => {
    const reply: WorkspaceList = { workspaces: listWorkspaces(req.userEmail!) };
    res.json(reply);
  }),
);
const newWsBody = z.object({ name: z.string().min(1) });
app.post(
  "/workspaces",
  validate(newWsBody),
  wrap((req, res) => {
    const { name } = req.body as z.infer<typeof newWsBody>;
    // The ONE place a workspace is created on request — getWorkspace deliberately refuses to (Examples aside).
    try {
      createWorkspace(req.userEmail!, name);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    res.json({ ok: true });
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

/** The BENCH on one library chain, made or refreshed — no repository, see docs/workspace.md. */
app.post(
  "/workspaces/bench",
  wrap(async (req, res) => {
    // Which chain the address named — `benchChainPath` is the one place either end spells that rule.
    const chain = benchChainPath(String(req.body?.project ?? ""));
    if (!chain)
      return res.status(404).json({
        error:
          "@banc opens a library chain — `chains/<path>.st0`. A shared MODULE is edited from the Libraries tab of a project you already have open.",
      });
    // The account's library repository, from the browser — the side that holds pl8's session.
    const libraries = String(req.body?.libraries ?? "");
    if (!libraries)
      return res.status(400).json({
        error:
          "no libraries repository — add one on st0's home page, in the card above the list",
      });
    try {
      res.json(await ensureChainBench(req.userEmail!, chain, libraries));
    } catch (e) {
      // A chain that will not open is the USER's problem to read, so it is a 409 and not a fault.
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
    try {
      assertSshGitUri(uri);
      const workspace = name || workspaceNameFor(req.userEmail!, uri);
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

// Play a song on THIS machine's outputs, without the engine and without a project — docs/machinePlayer.md.
app.use(playerRouter);

// An offline bounce for a hosted backend that cannot exec anything itself — docs/render.md.
app.use(renderRouter);

// Stem separation, started and polled because it takes minutes and produces four files — docs/stemSplit.md.
app.use(separateRouter);

// …and the same work for a caller that holds the audio and no cache path — docs/processChain.md.
app.use(processRouter);

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

// No /ssh-key here: pl8 owns the git identity and sshKeys.ts fetches a copy — packages/git-repos/docs/keys.md.

// No cut route here: pl8 drives a separation and posts the bytes — see docs/processChain.md.

// Everything else needs a resolved workspace on req.ws.
app.use(resolveWorkspace, filesRouter);

app.listen(FILE_PORT, "0.0.0.0", () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.studio/root exists
  // Only a long-lived process may skip `@studio/song`'s module-stamp walk — see moduleWatch.ts.
  installModuleWatch();
  // Same for the media library, tolerated rather than required: its root may be an unmounted drive.
  try {
    console.log(`   mediatek: ${ensureLayout()}`);
  } catch (e) {
    console.warn(`   mediatek unavailable: ${(e as Error).message}`);
  }
  console.log(`📁 st0 file service on http://0.0.0.0:${FILE_PORT}`);
  console.log(`   root: ${rootDir()}`);
  // Bring every known repo's Examples level with this build's demos, so a fix reaches existing users unseeded.
  syncAllRepos();
  // Log the effective policy: a bad allowlist otherwise surfaces only as an unexplained browser failure.
  console.log(`   cors: ${originPolicySummary()}`);
  // …and out loud when nothing gates the routes: this binds 0.0.0.0, so an open run is open on the LAN.
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
  // Reap engine sockets nobody has used in minutes — an abandoned link re-dials forever, see pruneIdleLinks.
  setInterval(() => {
    for (const s of pruneIdleLinks())
      console.log(`   engine link idle, dropped: ${s}`);
  }, 60_000).unref();
});
