// server.ts — pl8: the hosted media library. A folder on a volume scanned by @studio/mediatek
// and served over HTTP — the same vocabulary the local service speaks. It VERIFIES the session
// st0 mints and mounts no auth routes of its own. No database; see the package's docs/index.md
// and ../docs/auth.md.

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
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { projectsRouter } from "./routes/projects.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";

// Dev config layered INTO process.env, never read into a value — ../docs/config.md.
Object.assign(process.env, loadServiceEnv("pl8-backend"));

const PORT = Number(process.env.PORT || 8795);

// The volume, required rather than defaulted: the fallback is healthy AND empty, ../docs/config.md.
if (!process.env.STUDIO_MEDIATEK) {
  console.error(
    "error: STUDIO_MEDIATEK is not set — it must point at the mounted library volume.",
  );
  process.exit(1);
}

const app = express();
// The relay pipes bodies to an engine's file service, so the limit is that service's opinion.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

const { requireAuth } = await setupAuth(app, {
  // VERIFIES the cookie and mounts nothing, as k7 and z0 do — the flow is st0's, ../docs/gate.md.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "pl8-backend",
});

// A bearer stands in for the session: the LOCAL service syncing a cache has no cookie jar.
const { issueApiToken, verifyApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:pl8`,
);

// Everything is behind one of the two: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

// The user's git repositories — the browser has a cookie, the file service a bearer; docs/projects.md.
app.use(
  "/api/projects",
  bearerOrSession(requireAuth),
  projectsRouter({ verifyApiToken }),
);

/** THE ONE PUBLIC SURFACE: unguarded, and mounted ABOVE the `/api` guard — see docs/shares.md. */
app.use("/api/public/share", publicShareRouter());

// The author's half of the same thing: uploading a snapshot, listing them, taking one back.
app.use("/api/shares", bearerOrSession(requireAuth), sharesRouter());

// Finding songs on Soulseek. SESSION ONLY: it spends somebody's account — see docs/hunt.md.
app.use("/api/hunt", requireAuth, huntRouter);

// This service's OWN engine registry, mounted as st0 mounts one — see docs/engine.md.
const engine = mountEngineRegistry(app, { service: "pl8", requireAuth });

// Cutting a song into stems, driven from HERE because the bytes are here — docs/stems.md.
app.use("/api/stems", requireAuth, stemsRouter(engine));

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
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // An engine heartbeats to every advertised URL, and one never advertised lists no engines.
  engine.serve(server, url);
});
