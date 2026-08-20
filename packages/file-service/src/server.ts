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
import type { WorkspaceList } from "@studio/web-protocol";
import { benchChainPath } from "@studio/web-protocol/projects";
import cors from "cors";
import express from "express";
import { z } from "zod";
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
import { renderRouter } from "./routes/render.ts";
import { separateRouter } from "./routes/separate.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import {
  assertSshGitUri,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  UnknownWorkspaceError,
  workspaceForRepo,
  workspaceNameFor,
} from "./workspaces.ts";

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);
const ENGINE_PORT = Number(process.env.STUDIO_ENGINE_PORT || 8765);

const app = express();

// The callback form is deliberate: `origin: true` would reflect ANY origin. A refusal is RECORDED so the tray can
// offer it as a question — see docs/corsAndOrigins.md.
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

// Constant-time compare of a query token, mirroring requireEngineToken — including its three
// states: absent identity allows, unreadable one refuses.
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

// Media streaming for <video>: an element GET can't set headers, so user, workspace and token ride in the QUERY —
// which is why this route sits outside the header gates. Read-only, with the traversal guard still applied.
// Residual risk, deliberate: a token holder can read any user's media here. See docs/corsAndOrigins.md.
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

// Liveness, deliberately ungated and deliberately EMPTY: its one caller is a browser telling "my origin is refused"
// apart from "nothing is listening", which fetch() reports identically. It must reveal nothing — the answer IS the
// payload — and it sits after the cors middleware so a refused probe is still recorded for the tray.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- Everything below is header-gated: engine token + identity ---
app.use(requireEngineToken);
app.use(resolveUser);

// The workspace picker needs only the user, so it is registered BEFORE resolveWorkspace.
// Typed by the envelope `web-protocol` already declares for it: the type existed and described
// this reply, and nothing was held to it — so the wire and its description could drift with
// nobody the wiser. Naming it here is what makes the declaration true.
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

/**
 * Which workspace already holds a repository, if any. pl8 names a repo by its URI and knows
 * nothing about this machine's folders, so this is the question st0 asks before deciding
 * whether anything needs cloning at all.
 */
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

/**
 * The BENCH — made, or refreshed, and answered as a workspace + project.
 *
 * On ONE médiathèque chain (`chains/<path>.st0`), which is what the address's project part says.
 *
 * Its own route rather than a clone, because there is no repository: the bench is generated
 * from the médiathèque's catalogue and regenerated every time it is opened, so putting it under
 * version control would version a cache. `ProjectGate` calls this instead of the
 * by-name → by-repo → clone sequence when the address names `@banc`.
 *
 * A full sync of both families first, and that is the load-bearing line. `mediatekPull` fetches
 * only what the OPEN projects name (docs/mediatekPull.md), and a bench that has not been made
 * yet names nothing — so without this the folder it is about to mirror would be whatever
 * happened to be cached for other songs.
 */
app.post(
  "/workspaces/bench",
  wrap(async (req, res) => {
    // Which chain the address named. `benchChainPath` is the one place either end spells that
    // rule; anything else under `@banc` names nothing, which used to be the module bench.
    const chain = benchChainPath(String(req.body?.project ?? ""));
    if (!chain)
      return res.status(404).json({
        error:
          "@banc opens a library chain — `chains/<path>.st0`. A shared MODULE is edited from the Libraries tab of a project you already have open.",
      });
    // The account's library repository, from the browser — the side that holds the session pl8
    // answers to. The bench's workspace mounts it like any other, and the chain being opened is
    // inside it. Without one there is nothing to open, which the gate already refuses on.
    const libraries = String(req.body?.libraries ?? "");
    if (!libraries)
      return res.status(400).json({
        error:
          "no libraries repository — add one in the médiathèque's Projets section",
      });
    try {
      res.json(await ensureChainBench(req.userEmail!, chain, libraries));
    } catch (e) {
      // A chain that will not open is the USER's problem to read — no such chain, or a name that
      // collides with the bench's own furniture — so it is a 409 and not a fault.
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// Cloning runs HERE because this machine owns ~/.studio/root, and the deploy key is copied here.
// It STARTS the clone and answers with a job to poll: a real repository takes tens of seconds,
// which is longer than a request should be held open. See docs/cloneJobs.md.
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

// The media library is per MACHINE, so it needs the user (for the gate) but no workspace —
// registered here for the same reason /workspaces is.
app.use(mediatekRouter);

// Jouer un morceau du cache sur les sorties de CETTE machine, sans le moteur. Per machine et
// sans espace de travail, comme la médiathèque au-dessus : ce qu'on écoute n'appartient à aucun
// projet, et c'est justement ce qui permet d'écouter pendant que le moteur sert st0.
// Voir docs/machinePlayer.md.
app.use(playerRouter);

// An offline bounce, for a hosted backend that cannot exec anything itself. Per MACHINE
// too — it is this machine's engine binary and this machine's plugins — and behind the same
// engine-token gate everything above it is. See docs/render.md.
app.use(renderRouter);

// Stem separation, per machine for the same reasons and then some — it is this machine's model
// and this machine's GPU. Unlike a render it is started and polled, because it takes minutes
// and produces four files. See docs/stemSplit.md.
app.use(separateRouter);

// What this machine's engine has SCANNED, grouped by format. Per machine like the two above and
// for the same reason — the scan cache is `~/.studio/exts.json`, which belongs to no workspace and
// no project. `/hints` has carried the same list for a long time, but only alongside a compiled
// project, which is a thing the médiathèque does not have and will never have: it edits a library.
//
// Two shapes of the same answer, and both are used. `pluginNames` is what a name-matching
// field needs; `plugins` carries the role and the plugin's own category, which is what decides
// a module's PORTS and where it is filed — the médiathèque gives every scanned plugin a face
// and cannot do either from a name (see @studio/song's engineFace.ts).
app.get(
  "/plugins",
  wrap((_req, res) =>
    res.json({ pluginNames: scannedPluginNames(), plugins: scannedPlugins() }),
  ),
);

/**
 * …and what ONE of them HAS — every parameter of an installed plugin type.
 *
 * Beside `/plugins` and per machine for the same reason, but it is not read off the cache: the
 * scan carries a plugin's name, format and path and no parameters, because a plugin registers
 * them in its constructor. So this loads one and asks, on an offline engine of the engine's own
 * making, and takes SECONDS. A built-in needs no engine at all and never gets here — its list is
 * in `@studio/song`'s generated table.
 *
 * `format` and `id` together, because `id` is the binary's path: a display name can belong to
 * two formats of one plugin, and the engine resolves the pair, not the name.
 *
 * A 503 rather than an empty list when the engine cannot be reached or does not answer. The
 * caller writes a panel from what comes back, and an empty one is a REAL answer — a plugin with
 * no automatable parameters — so the two must not arrive spelt the same way.
 *
 * `found` rides back for the same reason one notch down: a plugin this machine cannot LOAD and
 * one that loads and publishes nothing are both an empty list, and only the first is worth
 * telling somebody about — it is a licence or an installation, not a fact about the plugin.
 */
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

/**
 * …and what one of them LOOKS LIKE — the plugin's own window, opened on this machine.
 *
 * Beside `/plugin-params` and taking the same `ref`, because it answers the other half of the same
 * question. A module is authored against a plugin by NAME, and a list of parameter names does not
 * tell you what `Amount Mod2` does; the plugin's own UI does, and it is the thing the plugin author
 * actually designed.
 *
 * The instance is an ORPHAN — no track, no session, no project — and NOTHING IT IS TOLD IS SAVED.
 * That is what makes it safe to open while something is playing, and it is also the limit worth
 * saying out loud: it is somewhere to LOOK at a plugin, not somewhere to set one. Values still
 * belong in the module's text.
 *
 * The window opens on THIS machine's screen, which is the engine's — so a browser on another
 * machine will be told the request succeeded and see nothing. That is not a bug this can fix: a
 * native plugin UI is a native window, and it draws where the plugin is loaded.
 *
 * 202 rather than 200: everything past "an engine took it" happens out of band, and the engine's
 * warning channel is where a plugin that will not load or has no editor gets to say so.
 */
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

// There is no /ssh-key here any more. pl8 owns the studio's git identity — it generates the
// one deploy key and shows it to you — and this machine fetches a copy when it first needs to
// clone (sshKeys.ts). See packages/git-repos/docs/keys.md.

// Everything else needs a resolved workspace on req.ws.
app.use(resolveWorkspace, filesRouter);

app.listen(FILE_PORT, "0.0.0.0", () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.studio/root exists
  // Let `@studio/song` skip its module-stamp walk while a watcher says nothing moved. HERE and
  // nowhere else, deliberately: it is a property of being a long-lived process that holds file
  // handles, which a CLI run, a test and a script are not. See moduleWatch.ts.
  installModuleWatch();
  // Same for the media library. Tolerated rather than required: the root is overridable
  // and may point at a drive that isn't mounted, which must not stop the file service —
  // the catalogue then simply reports no library.
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
  // …and say it out loud when nothing gates the routes. This binds 0.0.0.0, so an open run is
  // an open run on the whole LAN — worth a line rather than a state you have to infer.
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
  // Reap engine sockets nobody has used in minutes. One file service can serve several people,
  // and an abandoned link re-dials once a second forever — see pruneIdleLinks.
  setInterval(() => {
    for (const s of pruneIdleLinks())
      console.log(`   engine link idle, dropped: ${s}`);
  }, 60_000).unref();
});
