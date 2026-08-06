// server.ts — st0: the hosted media library, and the studio's front door. A folder on a
// volume scanned by @studio/mediatek and served over HTTP — the same vocabulary the local
// service speaks — plus the origin-wide OIDC flow, which it owns because it has no path
// prefix. No database; see the package's docs/index.md and ../docs/auth.md.

import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { setupAuth } from "@frediverse/oidc";
import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import {
  attachEngineProxy,
  createRegistry,
  engineRegistryRouter,
} from "@studio/engine-registry";
import { advertiseRegistry } from "@studio/engine-registry/advertise";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { projectsRouter } from "./routes/projects.ts";

// Dev config from the root env.yaml, layered INTO process.env — not read into a value.
// Everything downstream resolves the library through `process.env.STUDIO_MEDIATEK`, so a
// loader that merely RETURNED it would leave every consumer on the ~/.studio fallback
// while this service reported healthy. Full rationale: ../docs/config.md.
Object.assign(process.env, loadServiceEnv("st0-backend"));

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
  // This backend OWNS /auth/* for the WHOLE origin, because st0 is what the origin
  // root serves: `redirectUriFor` builds `<origin>/auth/callback` with no prefix, which
  // is only true for the service that has no prefix. l8, m9 and k7 pass `mountRoutes: []`
  // and merely VERIFY this cookie — same name, same SESSION_SECRET from env.yaml `common`,
  // or their check fails. All routes mounted, so no `mountRoutes` here.
  cookieName: "studio.sid",
  service: "st0-backend",
});

// A bearer token stands in for the session, because the main consumer has no cookie jar:
// the LOCAL service syncing a cache runs headless beside the engine. Same scheme k7
// already uses for the l8 CLI — a signed {sub,iat}, no server-side storage, rotate the
// secret to revoke everything.
const { issueApiToken, verifyApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:st0`,
);

// Everything is behind one of the two: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

// The user's git repositories. Same guard as the library and for the same reason: the browser
// arrives with a cookie, and the file service — which comes here for the deploy key so it can
// clone — is headless and carries the bearer. See docs/projects.md.
app.use(
  "/api/projects",
  bearerOrSession(requireAuth),
  projectsRouter({ verifyApiToken }),
);

// Finding songs on the Soulseek network, through a slskd daemon on another machine. Session
// only, unlike the two above: this one SPENDS somebody's bandwidth and queue slots on a network
// their account is known on, so it is not something a machine token should be able to start.
// See docs/hunt.md.
app.use("/api/hunt", requireAuth, huntRouter);

// This service's OWN engine registry. Until now a module preview was hardcoded to
// ws://127.0.0.1:8765, so "which engine" had no question to answer here — and no answer to
// offer either. Same mounting rule as l8: the browser routes need a session, the
// engine-facing heartbeat stays open because a machine authenticates with its own token.
app.use(["/api/engines", "/api/engine"], requireAuth);
const registry = createRegistry();
app.use("/api", engineRegistryRouter(registry));

// The engine this user auditions modules through. Same shape as l8', a different store:
// a person's médiathèque engine and their l8 engine are two choices, and this service is
// deployed on its own.
// `playbackTarget` is where the person's audio comes out. A plain string and not an enum on
// purpose: the list of destinations is the front-end's vocabulary (frontend/src/playback/
// targets.ts), and narrowing an unknown one is `asPlaybackTarget`'s job — so adding a
// destination is one entry there rather than an entry there AND a redeployed backend.
const prefsSchema = z.object({
  engineId: z.string().optional(),
  playbackTarget: z.string().optional(),
});
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

/**
 * The last word on an error, and the reason this service has one at all: a caller that HANGS UP.
 *
 * Three routes here read a body up to 512 MB (`PUT /file`, `POST /song`, `POST /recording`), and
 * a body that stops arriving is an everyday event — a cancelled upload, a closed tab, a socket
 * the engine relay gave up on. `raw-body` reports it as a `BadRequestError: request aborted`,
 * and it is thrown INSIDE the parser, where `wrap`'s try/catch cannot see it. Without a handler
 * of our own it reached Express's default one, which prints nine lines of stack and names
 * neither the method nor the path — a normal disconnect dressed as a crash, and undiagnosable.
 *
 * So: one line, and it says WHICH request. Nothing is written back — the socket is already gone,
 * and `res.headersSent` is the honest test for that.
 *
 * Four arguments, `_next` included and unused: that shape is how Express tells an error handler
 * from an ordinary middleware. Dropping it silently turns this into one that never runs.
 */
app.use(
  (
    err: Error & { type?: string; code?: string; status?: number },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // A disconnect, and nothing else: `entity.too.large` deliberately is NOT one — that caller
    // is still there and wants its 413, which `err.status` already carries.
    const gone =
      err.type === "request.aborted" ||
      err.code === "ECONNABORTED" ||
      err.code === "ECONNRESET";
    if (gone)
      console.warn(`↯ ${req.method} ${req.originalUrl}: ${err.message}`);
    else console.error(`✗ ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return void res.end();
    res
      .status(err.status ?? 500)
      .json({ error: err.message || "server error" });
  },
);

let unadvertise: (() => void) | null = null;

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // Created on boot like the local service does, so an empty volume is a working library
  // rather than a 404 until someone uploads.
  try {
    console.log(`📚 st0 backend on ${url}  (library + origin-wide auth)`);
    console.log(`   library: ${ensureLayout()}`);
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // This service holds its OWN registry, so the supervisor has to be told about it — an engine
  // heartbeats to every advertised URL, and one it never hears about lists no engines at all.
  unadvertise = advertiseRegistry("st0", url);
});

// The engine, relayed through this origin. Attached to the SERVER, not mounted as a route: a
// WebSocket upgrade never reaches Express's middleware chain. It is what makes an engine on
// another machine reachable at all — this page is HTTPS, and an HTTPS page may not open a
// `ws://` to a LAN address. See packages/engine-registry/docs/proxy.md.
attachEngineProxy(server, registry);

const bye = () => {
  unadvertise?.();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
