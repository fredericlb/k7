// server.ts — pl8: the hosted media library. A folder on a volume scanned by @studio/mediatek
// and served over HTTP — the same vocabulary the local service speaks — plus the origin-wide
// OIDC flow, which is still this backend's after its SPA moved under /pl8: the IdP knows one
// prefixless redirect_uri. No database; see the package's docs/index.md and ../docs/auth.md.

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

// Dev config from the root env.yaml, layered INTO process.env — not read into a value.
// Everything downstream resolves the library through `process.env.STUDIO_MEDIATEK`, so a
// loader that merely RETURNED it would leave every consumer on the ~/.studio fallback
// while this service reported healthy. Full rationale: ../docs/config.md.
Object.assign(process.env, loadServiceEnv("pl8-backend"));

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
// The relay pipes bodies through to an engine's file service, so the limit is that service's
// and not this one's opinion. See ENGINE_BODY_LIMIT.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

// Empty stays undefined, not []: setupAuth only falls back on nullish, so an empty array
// would ask the IdP for no scopes at all rather than for its defaults.
const scopes = (process.env.OIDC_SCOPES ?? "")
  .split(/[\s,]+/)
  .filter((s) => s !== "");

const { requireAuth } = await setupAuth(app, {
  // This backend OWNS /auth/* for the WHOLE origin: `redirectUriFor` builds
  // `<origin>/auth/callback` with no prefix, and that is the one redirect_uri registered at
  // the IdP. It owned it as the service that HAD no prefix; it kept it when l8 took the origin
  // root and this app moved to /pl8, because the flow cannot follow a SPA under a path — the
  // edge routes `/auth/` here by name (apps/studio/docker/nginx.conf). l8, m9 and k7 pass
  // `mountRoutes: []` and merely VERIFY this cookie — same name, same SESSION_SECRET from
  // env.yaml `common`, or their check fails. All routes mounted, so no `mountRoutes` here.
  cookieName: "studio.sid",
  service: "pl8-backend",
  // `groups` is not decoration: z0 now reads this same cookie and gates its editor,
  // presenter, monitor and remote on group membership (AUTH_ADMIN_GROUPS). The package
  // defaults to openid/profile/email, which would put an EMPTY groups array in every
  // session and lock every admin surface out with a 403 nobody could explain. The value
  // comes from env.yaml `common`, where it already reads "openid profile email groups".
  ...(scopes.length > 0 ? { scopes } : {}),
});

// A bearer token stands in for the session, because the main consumer has no cookie jar:
// the LOCAL service syncing a cache runs headless beside the engine. Same scheme k7
// already uses for the l8 CLI — a signed {sub,iat}, no server-side storage, rotate the
// secret to revoke everything.
const { issueApiToken, verifyApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:pl8`,
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

/**
 * THE ONE PUBLIC SURFACE, and its position on this page is load-bearing.
 *
 * A shared project is read by whoever holds its link and by nobody's session, so this router
 * carries no guard at all — which only works because it is mounted ABOVE the `app.use("/api",
 * requireAuth, …)` further down. Move it below and every shared link becomes a login redirect:
 * nothing throws at boot, no test fails, and the symptom appears on somebody else's screen.
 * `packages/engine-registry/mount.ts` writes up the same trap for the same reason.
 *
 * The failure is at least in the safe direction — a misplaced mount makes a share unreachable,
 * never public — and `publicShareRouter` ends in a terminal 404 so a miss cannot fall through to
 * that guard and come back 401 for something that does not exist. See docs/shares.md.
 */
app.use("/api/public/share", publicShareRouter());

// The author's half of the same thing: uploading a snapshot, listing them, taking one back.
// Same guard as the repositories, and for the same reason — the browser has a cookie, the file
// service that renders and uploads is headless and carries the bearer.
app.use("/api/shares", bearerOrSession(requireAuth), sharesRouter());

// Finding songs on the Soulseek network, through a slskd daemon on another machine. Session
// only, unlike the two above: this one SPENDS somebody's bandwidth and queue slots on a network
// their account is known on, so it is not something a machine token should be able to start.
// See docs/hunt.md.
app.use("/api/hunt", requireAuth, huntRouter);

// This service's OWN engine registry. Until now a module preview was hardcoded to
// ws://127.0.0.1:8765, so "which engine" had no question to answer here — and no answer to
// offer either. Same mounting rule as l8: the browser routes need a session, the
// engine-facing heartbeat stays open because a machine authenticates with its own token.
const engine = mountEngineRegistry(app, { service: "pl8", requireAuth });

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

// Mounted LAST, after every route. Three routes here read a body up to 512 MB (`PUT /file`,
// `POST /song`, `POST /recording`), so a caller that hangs up is an everyday event; the handler
// moved to @studio/engine-registry because l8 and m9 relay the same bytes and had none.
app.use(engineErrorHandler);

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // Created on boot like the local service does, so an empty volume is a working library
  // rather than a 404 until someone uploads.
  try {
    console.log(`📚 pl8 backend on ${url}  (library + origin-wide auth)`);
    console.log(`   library: ${ensureLayout()}`);
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
  // This service holds its OWN registry, so the supervisor has to be told about it — an engine
  // heartbeats to every advertised URL, and one it never hears about lists no engines at all.
  engine.serve(server, url);
});
