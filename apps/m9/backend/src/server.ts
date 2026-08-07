// server.ts — m9's backend: OIDC auth, this service's engine registry, and what it
// remembers about a person. Exactly l8' shape and for the same reason — it knows WHO you
// are and WHICH engines exist, never what is on any engine's disk. The decks still reach
// the file service and the moteur directly, cross-origin, as they always did.

import { homedir } from "node:os";
import { join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import {
  ENGINE_BODY_LIMIT,
  engineErrorHandler,
  mountEngineRegistry,
} from "@studio/engine-registry";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";

const PORT = process.env.PORT || 8796;
const app = express();

// The relay pipes bodies through to an engine's file service, so the limit is that service's
// and not this one's opinion. See ENGINE_BODY_LIMIT.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

// A login is mandatory even with no OIDC_* env (the shared dev stub stands in). It is what
// replaced the text box a DJ used to type their own identity into — an identity the file
// service then trusted, and which nothing checked.
const { requireAuth } = await setupAuth(app, {
  // The st0 backend owns /auth at the origin root — it is the service with no path prefix,
  // which is the only one the registered redirect_uri can reach. This one only VERIFIES its
  // cookie, so it mounts no auth routes. Same name and secret or the check fails.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "m9-backend",
});

// Its OWN registry — see packages/engine-registry/docs/shared.md for why each service holds
// one. The guard, the routes and the relay come as one call because their ORDER is what keeps
// the engine-facing heartbeat open while the browser-facing routes need a session.
const engine = mountEngineRegistry(app, {
  service: "m9",
  requireAuth,
  alsoGuard: ["/api/preferences"],
});

// The deck this account plays through. Same shape as l8' and the médiathèque's, a
// different store: which machine you DJ from is not which machine you write songs on.
const prefsSchema = z.object({ engineId: z.string().optional() });
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "m9");
app.use(
  "/api",
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

// Mounted LAST, after every route: a body that stops arriving throws inside the parser, where
// no route's own try/catch can see it. See engineErrorHandler.
app.use(engineErrorHandler);

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`🎚  m9 backend on ${url}  (auth + registry)`);
  // Announced here and not before: the supervisor heartbeats to every URL it finds, and one it
  // hears about before the port is bound is a beat into nothing.
  engine.serve(server, url);
});
