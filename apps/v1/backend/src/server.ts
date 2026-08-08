// server.ts — v1's backend: OIDC auth, this service's engine registry, and which machine the
// account cuts on. Exactly m9's shape and for the same reason — it knows WHO you are and WHICH
// machines exist, never what is on any machine's disk. The app reaches the file service direct.
//
// A "registry of engines" for an app that never plays a note is not a leftover: the registry is
// how a browser learns a machine's FILE SERVICE base and its token, and the project lives on a
// machine. See ../docs/plumbing.md.

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

const PORT = process.env.PORT || 8790;
const app = express();

// The relay pipes bodies through to a machine's file service, so the limit is that service's
// and not this one's opinion. See ENGINE_BODY_LIMIT.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

const { requireAuth } = await setupAuth(app, {
  // st0 owns /auth at the origin root — it is the service with no path prefix, which is the
  // only one the registered redirect_uri can reach. This one only VERIFIES its cookie, so it
  // mounts no auth routes. Same name and secret or the check fails.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "v1-backend",
});

// Its OWN registry — see packages/engine-registry/docs/shared.md for why each service holds
// one. The guard, the routes and the relay come as one call because their ORDER is what keeps
// the machine-facing heartbeat open while the browser-facing routes need a session.
const engine = mountEngineRegistry(app, {
  service: "v1",
  requireAuth,
  alsoGuard: ["/api/preferences"],
});

// The machine this account cuts on. Same shape as l8' and m9's, a different store: where you
// keep your footage is not where you keep your songs.
const prefsSchema = z.object({ engineId: z.string().optional() });
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "v1");
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
  console.log(`🎞  v1 backend on ${url}  (auth + registry)`);
  // Announced here and not before: the supervisor heartbeats to every URL it finds, and one it
  // hears about before the port is bound is a beat into nothing.
  engine.serve(server, url);
});
