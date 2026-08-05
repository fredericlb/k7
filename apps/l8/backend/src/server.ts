// server.ts — l8/web backend: the engine registry, and later serving the frontend. File
// operations moved to the engine-side file service, which the browser reaches directly — so
// this hosted piece knows WHO you are and WHICH engines exist, never what is on any engine's
// disk. It only VERIFIES the session; st0 mints it. Runs under tsx to import the brain's TS.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import {
  attachEngineProxy,
  createRegistry,
  engineRegistryRouter,
} from "@studio/engine-registry";
import { advertiseRegistry } from "@studio/engine-registry/advertise";
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
let unadvertise: (() => void) | null = null;

app.use(express.json({ limit: "8mb" }));

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

// Browser-facing registry routes need a session. Mounted before the router so the engine-to-backend routes
// (heartbeat, deregister — a machine authed by its own token) stay open.
app.use(["/api/engines", "/api/engine"], requireAuth);
// OUR registry, not the registry: st0 holds its own, and an engine heartbeats to both.
// See packages/engine-registry/docs/shared.md for why that is not one central one.
const registry = createRegistry();
app.use("/api", engineRegistryRouter(registry));

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

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // "verifies auth", not "auth": st0 mints the session, this only checks it.
  console.log(`🎛  l8-web backend on ${url}  (registry; verifies auth)`);
  unadvertise = advertiseRegistry("l8", url); // so the supervisor heartbeats to us
  advertiseLegacyEndpoint(url);
});

// The engine, relayed through this origin. Attached to the SERVER, not mounted as a route: a
// WebSocket upgrade never reaches Express's middleware chain. It is what makes an engine on
// another machine reachable at all — this page is HTTPS, and an HTTPS page may not open a
// `ws://` to a LAN address. See packages/engine-registry/docs/proxy.md.
attachEngineProxy(server, registry);

// On shutdown, drop our registry endpoint file. (Windows force-kills us, so --web does this cleanup too.)
const bye = () => {
  unadvertise?.();
  try {
    rmSync(WEB_ENDPOINT_PATH);
  } catch {
    /* no endpoint file */
  }
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
