// server.ts — pl8: the hosted media library. A folder on a volume scanned by @studio/mediatek
// and served over HTTP — the same vocabulary the local service speaks. It VERIFIES the session
// st0 mints and mounts no auth routes of its own. The filesystem is the index; the one exception
// is the comments on a share, which have many writers (../docs/comments.md). See the package's
// docs/index.md and ../docs/auth.md.

import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { precompressedStatic } from "@frediverse/http/precompressed";
import { behindProxy } from "@frediverse/http/proxied";
import { setupAuth } from "@frediverse/oidc";
import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import {
  ENGINE_BODY_LIMIT,
  engineErrorHandler,
  mountEngineRegistry,
} from "@studio/engine-registry";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import { startRevisionRefresh } from "@studio/mediatek/revision";
import { configureMpv } from "@studio/mpv-player/player";
import { createPlayerRouter } from "@studio/mpv-player/router";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import { isLoopbackReturn } from "@studio/web-protocol/pairing";
import express from "express";
import { z } from "zod";
import { startAnalysisSweep } from "./analysisSweep.ts";
import { openCors } from "./cors.ts";
import { mountFileHub, requireFilesRoot } from "./fileHub.ts";
import { engineLocalRouter } from "./routes/engineLocal.ts";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { settingsRouter } from "./routes/settings.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";
import { sharesDir } from "./shares/store.ts";
import { clearUploads, libraryUploads } from "./upload.ts";

// Dev config layered INTO process.env, never read into a value — ../docs/config.md.
Object.assign(process.env, loadServiceEnv("pl8-backend"));

// A stray rejection is logged and survived; an uncaught exception leaves, and the container restarts it.
process.on("unhandledRejection", (reason) =>
  console.error("unhandled rejection:", reason),
);
process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  process.exit(1);
});

// Before anything listens: without it no project can open anywhere — packages/file-hub/docs/fileHub.md.
const FILES_ROOT = requireFilesRoot();

const PORT = Number(process.env.PORT || 8795);

const app = express();
// The relay pipes bodies to an engine's file service, so the limit is that service's opinion.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));
// Every origin's preflight is answered before anything else runs — docs/cors.md.
app.use(openCors);

const { requireAuth } = await setupAuth(app, {
  // VERIFIES the cookie and mounts nothing, as k7 and z0 do — the flow is st0's, ../docs/gate.md.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "pl8-backend",
});

// A bearer stands in for the session: a service calling pl8 — k7, an account's file service — has no cookie jar.
const { issueApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:pl8`,
);

// Everything is behind one of the two: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

// NO /api/projects: this service knows nothing about git — apps/st0/frontend/docs/projects.md.

/** THE ONE PUBLIC SURFACE: unguarded, and mounted ABOVE the `/api` guard — see docs/shares.md. */
app.use("/api/public/share", publicShareRouter());

// The author's half of the same thing: uploading a snapshot, listing them, taking one back.
app.use("/api/shares", bearerOrSession(requireAuth), sharesRouter());

// Finding songs on Soulseek. SESSION ONLY: it spends somebody's account — see docs/hunt.md.
app.use("/api/hunt", requireAuth, huntRouter);
// …and the settings it spends — session only too, since they hold the slskd key (docs/settings.md).
app.use("/api/settings", requireAuth, settingsRouter);

// This service's OWN engine registry, mounted as st0 mounts one — see docs/engine.md.
const engine = mountEngineRegistry(app, { service: "pl8", requireAuth });

// The accounts' workspaces, which live here and nowhere else — packages/file-hub/docs/fileHub.md.
const fileHub = mountFileHub(
  app,
  engine,
  requireAuth,
  PORT,
  FILES_ROOT,
  issueApiToken,
);

// Play on THIS host's outputs: the library is right here, so a path is all that crosses —
// packages/mpv-player/docs/mpvPlayer.md. Under a dot-directory, like the prefs below, so no
// family scan ever sees the sockets.
configureMpv({
  mediaRoot: mediatekDir,
  socketDir: () => join(mediatekDir(), ".player"),
});
app.use(
  "/api",
  bearerOrSession(requireAuth),
  createPlayerRouter((req) => {
    const who = (req as { user?: { sub?: string; email?: string } }).user;
    return who?.email ?? who?.sub ?? "";
  }),
);

// Cutting a song into stems, driven from HERE because the bytes are here; a bearer too, unlike /api/hunt above — docs/stems.md.
app.use(
  "/api/stems",
  bearerOrSession(requireAuth),
  stemsRouter(engine, (user, chain, want) =>
    fileHub.coldRun(user, chain, want),
  ),
);

// Where a song is on an engine's machine, fetched there first — what the player hands the engine.
app.use("/api/engine-local", requireAuth, engineLocalRouter(engine));

// `engineId` is this app's own choice, `playbackTarget` a plain string — docs/playbackTarget.md.
const prefsSchema = z.object({
  engineId: z.string().optional(),
  playbackTarget: z.string().optional(),
});
// On the library volume, under a dot-directory so no family scan ever sees it.
const PREFS_DIR = process.env.STUDIO_PREFS_DIR || join(mediatekDir(), ".prefs");
app.use(
  "/api",
  requireAuth,
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

// A token for a DESKTOP app on its loopback port; isLoopbackReturn IS this route's security (apps/st0-desktop/docs/pairing.md).
app.get("/api/token/pair", requireAuth, (req, res) => {
  const back = String(req.query.return ?? "");
  // The predicate is shared with the app that builds this address: one rule, two sides.
  if (!isLoopbackReturn(back))
    return res
      .status(400)
      .json({ error: "return must be an http loopback address" });
  const target = new URL(back);

  const who = (req as { user?: { sub?: string; email?: string } }).user;
  const id = who?.sub ?? who?.email;
  if (!id) return res.status(401).json({ error: "no user on the session" });

  target.searchParams.set("token", issueApiToken(id));
  target.searchParams.set("identity", who?.email ?? id);
  if (typeof req.query.state === "string")
    target.searchParams.set("state", req.query.state);
  res.redirect(target.toString());
});

/** Mint a token for the signed-in user. Session only: a token must not mint another. */
app.post("/api/token", requireAuth, (req, res) => {
  const sub = (req as { user?: { sub?: string; email?: string } }).user;
  const id = sub?.sub ?? sub?.email;
  if (!id) return res.status(401).json({ error: "no user on the session" });
  res.json({ token: issueApiToken(id) });
});

// The built SPA — this process's own frontend/dist, since there is no nginx in this image.
// Static files first (an asset request that matches a real file wins outright), then a
// catch-all SPA fallback for everything else EXCEPT /api and /auth, which answer their own
// 404 rather than being swallowed into the shell — this backend mounts neither (mountRoutes:
// [] for auth, and an unmatched /api/* is a real 404), and the frontend never asks it to
// answer either (see api.ts), but a 200-with-HTML is a worse failure than a clean 404 for
// anything that does.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
// The shell is asked again on every load and a hashed asset is kept for good — ../../../../docs/versioning.md.
const SHELL_CACHE = "no-cache";
app.use(
  precompressedStatic(FRONTEND_DIST, {
    setHeaders: (res, path) =>
      res.setHeader(
        "Cache-Control",
        path.startsWith(join(FRONTEND_DIST, "assets"))
          ? "public, max-age=31536000, immutable"
          : SHELL_CACHE,
      ),
  }),
);
app.get(/^(?!\/api|\/auth)/, (_req, res) => {
  res.setHeader("Cache-Control", SHELL_CACHE);
  res.sendFile(join(FRONTEND_DIST, "index.html"));
});

// Mounted LAST: three routes read a 512 MB body, so a caller hanging up is an everyday event.
app.use(engineErrorHandler);

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // Created on boot, so an empty volume is a working library rather than a 404 until an upload.
  try {
    console.log(`📚 pl8 backend on ${url}  (library + origin-wide auth)`);
    console.log(`   library: ${ensureLayout()}`);
    clearUploads(libraryUploads());
    clearUploads(join(sharesDir(), "uploads"));
    // A poll costs a map lookup from here on, and the walk that fills it runs off the loop.
    startRevisionRefresh();
    // …and the waveforms nobody has asked for yet, one at a time — apps/pl8/docs/analysis.md.
    startAnalysisSweep();
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // Advertised so this machine's file service finds the médiathèque; an engine joins this registry only once the user adds it in the tray.
  engine.serve(server, url, () => void fileHub.stop());
});
behindProxy(server);
// Node's default cuts a request at 5 minutes, and a 512 MB upload over a slow link takes longer.
server.requestTimeout = 30 * 60_000;
