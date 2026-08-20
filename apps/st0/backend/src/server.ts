// server.ts — st0/web backend: the engine registry, and later serving the frontend. File
// operations moved to the engine-side file service, which the browser reaches directly — so
// this hosted piece knows WHO you are and WHICH engines exist, never what is on any engine's
// disk. It MINTS the session every studio service verifies, being the one with no path prefix.
// Runs under tsx to import the brain's TS.

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

// Where the engine-host supervisor looks for the registry: `st0 --web` picks a free port, so we drop our
// real URL here on boot and remove it on shutdown. A hosted deploy sets STUDIO_REGISTRY_URL instead.
//
// The legacy single-URL file is written ALONGSIDE the per-service one, and only by st0: a tray built
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

// Empty stays undefined, not []: setupAuth only falls back on nullish, so an empty array
// would ask the IdP for no scopes at all rather than for its defaults.
const scopes = (process.env.OIDC_SCOPES ?? "")
  .split(/[\s,]+/)
  .filter((s) => s !== "");

// Auth: the browser must be logged in before it can list or select engines (shared
// @frediverse/oidc), and this backend is where the flow itself lives.
const { requireAuth } = await setupAuth(app, {
  // This backend OWNS /auth/* for the WHOLE origin. One origin, one session: `redirectUriFor`
  // builds `<origin>/auth/callback` with no prefix, and that is the single redirect_uri the IdP
  // has registered — so the flow belongs to whichever service has NO prefix, which is this one
  // since st0 became the studio's front door. pl8, k7 and z0 pass `mountRoutes: []` and merely
  // VERIFY the cookie: same name, same SESSION_SECRET from env.yaml `common`, or their check
  // fails. All routes mounted, so no `mountRoutes` here.
  //
  // It was pl8's — the médiathèque answered the root then — and came back with the root rather
  // than being moved for its own sake. Nothing was re-registered at the IdP either time: the
  // redirect_uri never changed, only which process serves it.
  cookieName: "studio.sid",
  // The env.yaml section this backend reads. It is the PACKAGE name, like every other
  // service's — it was `st0-web-backend`, the one exception, from back when this app had a
  // CLI half to be distinguished from.
  service: "st0-backend",
  // `groups` is not decoration: z0 reads this same cookie and gates its editor, presenter,
  // monitor and remote on group membership (AUTH_ADMIN_GROUPS). The package defaults to
  // openid/profile/email, which would put an EMPTY groups array in every session and lock every
  // admin surface out with a 403 nobody could explain. The value comes from env.yaml `common`,
  // where it already reads "openid profile email groups".
  ...(scopes.length > 0 ? { scopes } : {}),
});

// OUR registry, not the registry: pl8 holds its own, and an engine heartbeats to both.
// See packages/engine-registry/docs/shared.md for why that is not one central one.
const engine = mountEngineRegistry(app, { service: "st0", requireAuth });

/**
 * One person's own layer over a command: what to call it, in each language, plus its icon, its
 * place in a menu, its shortcut, and whether a right-click may offer it.
 *
 * The frontend's `commandPrefs.ts` owns the meaning; this is the shape on the wire. A structural
 * copy and not an import, like pl8's `Pl8Prefs` the other way round — the backend is a separate
 * build and that one is a browser bundle.
 *
 * `label` takes a bare string too: that is what the field was before there was one per language,
 * and a document written then still says what it always said (see `CommandLabel`).
 */
const commandPrefSchema = z.object({
  label: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
  key: z.string().optional(),
  menu: z.boolean().optional(),
});

/**
 * What this service remembers about a person: the engine they drive, and what they have made of
 * the command catalogue.
 *
 * `engineId` and not an address: an engine's IP moves between networks while its identity
 * does not, and the browser re-probes the addresses from the registry on every load anyway.
 * Storing a URL would pin the user to the network they first logged in from.
 *
 * **This schema is the GATE, not a description.** A zod object strips what it does not declare,
 * so a field the frontend saves and this does not name is accepted, answered `{ok:true}`, and
 * dropped — which is exactly what happened to `commands` for as long as this said "one field so
 * far". The router refuses such a write out loud now (`droppedKeys`), but the rule to remember is
 * that widening `St0Prefs` in the browser is only half of adding a preference.
 */
const prefsSchema = z.object({
  engineId: z.string().optional(),
  commands: z.record(z.string(), commandPrefSchema).optional(),
});
// Defaults under the home directory so a dev run works with no volume at all; a deploy
// mounts one and points this at it. See packages/user-prefs/docs/store.md.
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "st0");
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
  // "auth", not "verifies auth": this backend MINTS the session now — it owns /auth/* for the
  // whole origin, being the service with no path prefix. It read "verifies" while pl8 did.
  console.log(`🎛  st0-web backend on ${url}  (registry; auth)`);
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
