// server.ts — l8/web backend: the engine registry, and later serving the frontend. File
// operations moved to the engine-side file service, which the browser reaches directly — so
// this hosted piece knows WHO you are and WHICH engines exist, never what is on any engine's
// disk. It only VERIFIES the session; st0 mints it. Runs under tsx to import the brain's TS.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

const PORT = process.env.PORT || 8789;
const app = express();

// Where the engine-host supervisor looks for the registry: `l8 --web` picks a free port, so we drop our
// real URL here on boot and remove it on shutdown. A hosted deploy sets STUDIO_REGISTRY_URL instead.
//
// The legacy single-URL file is written ALONGSIDE the per-service one, and only by l8: a tray built
// before `web-endpoints/` existed reads nothing else, and version skew between an installed tray and a dev
// backend must not cost this app its engine. Nothing new should write it.
const WEB_ENDPOINT_PATH = join(homedir(), ".studio", "web-endpoint.json");
function advertiseLegacyEndpoint(url: string): void {
  try {
    mkdirSync(dirname(WEB_ENDPOINT_PATH), { recursive: true });
    writeFileSync(WEB_ENDPOINT_PATH, JSON.stringify({ url }) + "\n", "utf8");
  } catch {
    /* unwritable — the supervisor can still be pointed with --registry */
  }
}
// The relay pipes bodies through to an engine's file service, so the limit is that service's
// and not this one's opinion. See ENGINE_BODY_LIMIT.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

// Auth: the browser must be logged in before it can list or select engines (shared
// @frediverse/oidc). No routes are mounted — see below — so a login sends the browser to
// st0's /auth and comes back here with a cookie this only checks.
const { requireAuth } = await setupAuth(app, {
  // Shared across every studio service: one origin, one session. ST0 owns the flow
  // now — it serves the origin root, and `redirectUriFor` names `<origin>/auth/callback`
  // with no prefix, which is only true for the service that has no prefix. This backend
  // used to own it, from when l8 was what the bare origin redirected to. It VERIFIES the
  // cookie and mounts no auth routes: same SESSION_SECRET, from env.yaml common.
  cookieName: "studio.sid",
  mountRoutes: [],
  // The env.yaml section this backend reads. It is the PACKAGE name, like every other
  // service's — it was `l8-web-backend`, the one exception, from back when this app had a
  // CLI half to be distinguished from.
  service: "l8-backend",
});

// OUR registry, not the registry: st0 holds its own, and an engine heartbeats to both.
// See packages/engine-registry/docs/shared.md for why that is not one central one.
const engine = mountEngineRegistry(app, { service: "l8", requireAuth });

/**
 * What this service remembers about a person. One field so far: the engine they drive.
 *
 * `engineId` and not an address: an engine's IP moves between networks while its identity
 * does not, and the browser re-probes the addresses from the registry on every load anyway.
 * Storing a URL would pin the user to the network they first logged in from.
 */
const prefsSchema = z.object({ engineId: z.string().optional() });
// Defaults under the home directory so a dev run works with no volume at all; a deploy
// mounts one and points this at it. See packages/user-prefs/docs/store.md.
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "l8");
app.use(
  "/api",
  requireAuth,
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
  // "verifies auth", not "auth": st0 mints the session, this only checks it.
  console.log(`🎛  l8-web backend on ${url}  (registry; verifies auth)`);
  // The legacy file goes with the shared goodbye rather than beside it: the socle installs the
  // signal handlers and exits in them, so a second handler here would never run.
  // (Windows force-kills us, so --web does this cleanup too.)
  engine.serve(server, url, () => {
    try {
      rmSync(WEB_ENDPOINT_PATH);
    } catch {
      /* no endpoint file */
    }
  });
  advertiseLegacyEndpoint(url);
});
