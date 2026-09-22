// server.ts — pl8: the hosted media library. A folder on a volume scanned by @studio/mediatek
// and served over HTTP — the same vocabulary the local service speaks. It VERIFIES the session
// st0 mints and mounts no auth routes of its own. The filesystem is the index; the one exception
// is the comments on a share, which have many writers (../docs/comments.md). See the package's
// docs/index.md and ../docs/auth.md.

import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
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
import { createTrustedOriginCors } from "./cors.ts";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";
import { syncRouter } from "./routes/sync.ts";

// Dev config layered INTO process.env, never read into a value — ../docs/config.md.
Object.assign(process.env, loadServiceEnv("pl8-backend"));

const PORT = Number(process.env.PORT || 8795);

const app = express();
// The relay pipes bodies to an engine's file service, so the limit is that service's opinion.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));
// st0 and k7, now on their own subdomains, call this API directly — allow
// them (and answer their preflight) before anything else runs. See cors.ts;
// TRUSTED_ORIGINS is populated by the Object.assign above, not read here.
app.use(createTrustedOriginCors());

const { requireAuth } = await setupAuth(app, {
  // VERIFIES the cookie and mounts nothing, as k7 and z0 do — the flow is st0's, ../docs/gate.md.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "pl8-backend",
});

// A bearer stands in for the session: the LOCAL service syncing a cache has no cookie jar.
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

// This service's OWN engine registry, mounted as st0 mounts one — see docs/engine.md.
const engine = mountEngineRegistry(app, { service: "pl8", requireAuth });

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
app.use("/api/stems", bearerOrSession(requireAuth), stemsRouter(engine));

// Copying a set list onto a machine's stick or FTP box — same division as the cut, docs/sync.md.
app.use("/api/sync", bearerOrSession(requireAuth), syncRouter(engine));

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

// Mounted LAST: three routes read a 512 MB body, so a caller hanging up is an everyday event.
app.use(engineErrorHandler);

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // Created on boot, so an empty volume is a working library rather than a 404 until an upload.
  try {
    console.log(`📚 pl8 backend on ${url}  (library + origin-wide auth)`);
    console.log(`   library: ${ensureLayout()}`);
    // A poll costs a map lookup from here on, and the walk that fills it runs off the loop.
    startRevisionRefresh();
    // …and the waveforms nobody has asked for yet, one at a time — apps/pl8/docs/analysis.md.
    startAnalysisSweep();
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // An engine heartbeats to every advertised URL, and one never advertised lists no engines.
  engine.serve(server, url);
});
