// server.ts — the hosted media library. A folder on a volume, scanned by @studio/mediatek
// and served over HTTP: the same vocabulary the local service speaks, so the machine that
// caches it asks both sides the same questions. No database — see the package's docs/index.md.

import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { setupAuth } from "@frediverse/oidc";
import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import { createRegistry, engineRegistryRouter } from "@studio/engine-registry";
import { advertiseRegistry } from "@studio/engine-registry/advertise";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";
import { libraryRouter } from "./routes/library.ts";

// Dev config from the root env.yaml, layered INTO process.env — not read into a value.
// Everything downstream resolves the library through `process.env.STUDIO_MEDIATEK`, so a
// loader that merely RETURNED it would leave every consumer on the ~/.studio fallback
// while this service reported healthy. Full rationale: ../docs/config.md.
Object.assign(process.env, loadServiceEnv("mediatek-backend"));

const PORT = Number(process.env.PORT || 8795);

// The volume. Required, not defaulted: @studio/mediatek falls back to ~/.studio/mediatek,
// which inside a container is an empty directory nobody mounted — the service would come
// up healthy and serve an empty library, which is the worst possible failure here.
if (!process.env.STUDIO_MEDIATEK) {
  console.error(
    "error: STUDIO_MEDIATEK is not set — it must point at the mounted library volume.",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const { requireAuth } = await setupAuth(app, {
  // The pistes backend owns /auth at the origin root; this one only VERIFIES its
  // cookie, so it mounts no auth routes. Same name and secret or the check fails.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "mediatek-backend",
});

// A bearer token stands in for the session, because the main consumer has no cookie jar:
// the LOCAL service syncing a cache runs headless beside the engine. Same scheme k7
// already uses for the pistes CLI — a signed {sub,iat}, no server-side storage, rotate the
// secret to revoke everything.
const { issueApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET ||
    `${process.env.SESSION_SECRET ?? ""}:mediatek`,
);

// Everything is behind one of the two: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

// This service's OWN engine registry. Until now a module preview was hardcoded to
// ws://127.0.0.1:8765, so "which engine" had no question to answer here — and no answer to
// offer either. Same mounting rule as pistes: the browser routes need a session, the
// engine-facing heartbeat stays open because a machine authenticates with its own token.
app.use(["/api/engines", "/api/engine"], requireAuth);
app.use("/api", engineRegistryRouter(createRegistry()));

// The engine this user auditions modules through. Same shape as pistes', a different store:
// a person's médiathèque engine and their pistes engine are two choices, and this service is
// deployed on its own.
const prefsSchema = z.object({ engineId: z.string().optional() });
// On the library volume — the one this service already requires — under a dot-directory, so
// it never shows up in a family scan. See packages/user-prefs/docs/store.md.
const PREFS_DIR = process.env.STUDIO_PREFS_DIR || join(mediatekDir(), ".prefs");
app.use(
  "/api",
  requireAuth,
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

/** Mint a token for the signed-in user — what you paste into a machine's settings once.
 *  Session only, deliberately: a token must not be able to mint another. */
app.post("/api/token", requireAuth, (req, res) => {
  const sub = (req as { user?: { sub?: string; email?: string } }).user;
  const id = sub?.sub ?? sub?.email;
  if (!id) return res.status(401).json({ error: "no user on the session" });
  res.json({ token: issueApiToken(id) });
});

let unadvertise: (() => void) | null = null;

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // Created on boot like the local service does, so an empty volume is a working library
  // rather than a 404 until someone uploads.
  try {
    console.log(`📚 mediatek backend on ${url}`);
    console.log(`   library: ${ensureLayout()}`);
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // This service holds its OWN registry, so the supervisor has to be told about it — an engine
  // heartbeats to every advertised URL, and one it never hears about lists no engines at all.
  unadvertise = advertiseRegistry("mediatek", url);
});

const bye = () => {
  unadvertise?.();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
