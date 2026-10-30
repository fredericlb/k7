// server.ts — the studio's hosted backend: the origin's OIDC flow (it MINTS the session every
// studio app verifies), the account's preferences, the rehearsal recorder (@studio/rehearsal-server),
// the media library and its engine registry (./media/mount.ts), and the built SPA — docker/ ships
// no nginx. A former host's page goes to k7's origin — `play.` and `k7.` under `/media` or `/rehearsal`.
// Rehearsal is mounted BEFORE the library: the library's catch-all `/api` guard would swallow it.
// The registry installs no signal handler here: the stop below says its goodbye, then closes gracefully.
// Runs under tsx to import the brain's TS.

import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { precompressedStatic } from "@frediverse/http/precompressed";
import { behindProxy } from "@frediverse/http/proxied";
import { setupAuth } from "@frediverse/oidc";
import { mountRehearsal } from "@studio/rehearsal-server";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import { isLegacyHost, serviceUrl } from "@studio/web-protocol/services";
import express from "express";
import { z } from "zod";
import { aiOrganizeBody, aiOrganizeRouter } from "./aiOrganize";
import {
  appDownloadsRouter,
  appReleasesRouter,
  maxBytesFromEnv,
  storesFromEnv,
} from "./appReleases/routes.ts";
import { authRefusals, DEFAULT_SESSION_SECRET } from "./authGuard.ts";
import { sessionRevocations } from "./authState.ts";
import { jsonBodies } from "./bodyLimits.ts";
import { CameraHub } from "./cameras/hub.ts";
import { camerasRouter } from "./cameras/routes.ts";
import { cameraTickets, iceServersFromEnv } from "./cameras/ticket.ts";
import { withDevAdmin } from "./devAdmin.ts";
import { devFrontend } from "./devFrontend.ts";
import { mountHandoff } from "./handoff.ts";
import {
  jsonErrorHandler,
  securityHeaders,
  shellFrameHeaders,
} from "./hardening.ts";
import { awaitLibraries } from "./listenGate.ts";
import { listPairedOnce, pairingHooks } from "./localEngine/followPairings.ts";
import { localEngineFromEnv } from "./localEngine/host.ts";
import {
  localEngineRouter,
  localInfoRouter,
  trayRouter,
} from "./localEngine/routes.ts";
import { loopbackOnly } from "./loopback.ts";
import { originPolicyFromEnv, studioCors } from "./media/cors.ts";
import { mediaTokens, mountMedia } from "./media/mount.ts";
import { readinessRoute, volumesFromEnv } from "./readiness.ts";
import { deviceDoor } from "./remote/door.ts";
import { forwardToPairedServer, SERVER_PATH } from "./remote/forward.ts";
import { siteHostsFromEnv, sitePage } from "./sitePage.ts";
import { BUILD, VERSION } from "./version.ts";
import { subjectOf } from "./who.ts";

// A stray rejection is logged and survived; an uncaught exception leaves, and the container restarts it.
process.on("unhandledRejection", (reason) =>
  console.error("unhandled rejection:", reason),
);
process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  process.exit(1);
});

// Dev config layered INTO process.env, never read into a value — ../docs/media/config.md.
Object.assign(process.env, loadServiceEnv("k7-backend"));

// No dev-user stub and no guessable session secret on a server — ../docs/hardening.md.
const refusals = authRefusals(process.env);
if (refusals.length > 0) {
  for (const r of refusals) console.error(`FATAL: ${r}`);
  console.error(
    "FATAL: refusing to start; set STUDIO_DEV_AUTH=1 only for a local dev session",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8789);
// Unset, every interface; the desktop and the phone set 127.0.0.1 (../docs/standalone.md).
const LISTEN_HOST = process.env.STUDIO_LISTEN_HOST || undefined;
const LOCAL_USER = process.env.STUDIO_LOCAL_USER === "1";
const app = express();
// Express's own banner tells a client nothing it needs.
app.disable("x-powered-by");
app.use(securityHeaders);

// A backend that signs anyone in as the local user answers its own machine, by address and by name.
if (LOCAL_USER) app.use(loopbackOnly);
// Listed origins only, and no cross-site write, before anything else runs — ../docs/media/cors.md.
app.use(studioCors(originPolicyFromEnv()));
// Liveness: no session, no disk, only that the loop answers — and which release answers.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, build: BUILD });
});
// Readiness, what the image's healthcheck asks: the volumes take a write, no file-service start is stuck (./readiness.ts).
app.get(
  "/api/ready",
  loopbackOnly,
  readinessRoute({
    volumes: volumesFromEnv(),
    files: () => media.fileStatus(),
  }),
);
// The module builder's AI organize takes a whole module, so it parses first, with its own limit.
app.use("/api/ai", aiOrganizeBody);
// Small for everyone, since it runs before any guard; the relayed paths are piped unparsed (./bodyLimits.ts).
app.use(jsonBodies());
// The apps' builds, on the hosted origin only: CI uploads with its own bearer, anyone downloads (docs/app-downloads.md).
if (!LOCAL_USER) {
  const releases = storesFromEnv();
  app.use(
    "/api/app-releases",
    appReleasesRouter(
      releases,
      process.env.APP_RELEASE_TOKEN || undefined,
      maxBytesFromEnv(),
    ),
  );
  app.use("/app_downloads", appDownloadsRouter(releases));
}
// The root domain and www.: one page, before the session and everything else (./sitePage.ts).
app.use(sitePage(siteHostsFromEnv()));

// Empty means k7's own default, not the package's: without `groups` every session is no admin.
const scopes = (process.env.OIDC_SCOPES || "openid profile email groups")
  .split(/[\s,]+/)
  .filter((s) => s !== "");

// This backend OWNS /auth/* for the whole origin, being the service with no prefix (../../AGENTS.md).
const auth = await setupAuth(app, {
  cookieName: "studio.sid",
  // A logout everywhere outlives a restart (../docs/sessions.md).
  revocations: sessionRevocations(),
  // The env.yaml section, which is the PACKAGE name here as everywhere else.
  service: "k7-backend",
  // Dropping `groups` would 403 every admin surface — see ../../AGENTS.md, § The backend in detail.
  scopes,
});
// A local dev session's stub user is an admin, nobody else's is (./devAdmin.ts).
const requireAuth = withDevAdmin(auth.requireAuth);
// Under the tray: the machine's supervisor, run by this backend, for k7's pages and the tray (./localEngine/).
const localEngine = LOCAL_USER
  ? localEngineFromEnv(`http://127.0.0.1:${PORT}`)
  : null;
if (localEngine)
  app.use("/api/local/engine", localEngineRouter(localEngine, requireAuth));
if (LOCAL_USER) {
  app.use(
    "/api/local/tray",
    trayRouter(localEngine, process.env.K7_TRAY_TOKEN),
  );
  // The tray's release, which names what this machine runs; a phone's backend has only its package version.
  app.use(
    "/api/local",
    localInfoRouter(localEngine, process.env.K7_RELEASE || VERSION),
  );
}
// An app's system-browser sign-in, and the desktop's signed-out local user (../docs/handoff.md).
mountHandoff(app, {
  secret: process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
  localUser: LOCAL_USER,
  auth,
});

// Under the home directory so a dev run needs no volume (packages/user-prefs/docs/store.md).
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "k7");
// Ahead of every route they reach: a paired machine browsing this server, and on that machine its page reaching it (../docs/serverPicker.md).
if (LOCAL_USER)
  app.use(
    SERVER_PATH,
    requireAuth,
    forwardToPairedServer((req) => media.pairedServer(req)),
  );
else
  app.use(
    deviceDoor({
      deviceUser: (token) => media.deviceUser(token),
      startSession: auth.startSession,
    }),
  );

// A device in camera mode, offered to its own account; ahead of the library's catch-all `/api` guard (../docs/cameras.md).
const cameraTicketKeys = cameraTickets();
const cameras = new CameraHub(cameraTicketKeys);
app.use(
  "/api/cameras",
  camerasRouter({
    hub: cameras,
    tickets: cameraTicketKeys,
    iceServers: iceServersFromEnv(process.env.K7_CAMERA_ICE_SERVERS),
    requireAuth,
    accountOf: subjectOf,
  }),
);

// The library's tokens first, so the rehearsal server, mounted ahead of it, can call it with one.
const tokens = mediaTokens();
// Before the library: its public pages are unguarded and its releases take k7's own bearer.
const rehearsal = mountRehearsal(app, {
  requireAuth,
  // Asked per request, so it is the media mount's once that exists: a desktop's releases are its server's.
  server: (req) => media.pairedServer(req),
  mediatek: {
    base: `http://127.0.0.1:${PORT}`,
    token: tokens.issueApiToken("service:k7", { ephemeral: true }),
  },
});
// Mounted before the prefs below: their `/api` guard is session-only, and a bearer or a ticket must reach these first.
const media = mountMedia(app, {
  requireAuth,
  port: PORT,
  tokens,
  onRemote: localEngine ? pairingHooks(localEngine) : undefined,
  favorites: {
    own: prefsStore(join(PREFS_DIR, "favorites")),
    prefs: prefsStore(PREFS_DIR),
  },
  practice: { own: prefsStore(join(PREFS_DIR, "practice")) },
});

/** One person's layer over a command, as the WIRE shape — the meaning is the frontend's `commandPrefs.ts`. */
const commandPrefSchema = z.object({
  label: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
  key: z.string().optional(),
  // Which right-clicks may offer it: a list of entities, or `false` for none — see the frontend's commandPrefs.ts.
  menu: z.union([z.boolean(), z.array(z.string())]).optional(),
});

/** What this service remembers about a person — the GATE, not a description; `playbackTarget` is ../docs/media/playbackTarget.md. */
const prefsSchema = z.object({
  engineId: z.string().optional(),
  commands: z.record(z.string(), commandPrefSchema).optional(),
  playbackTarget: z.string().optional(),
  // Kept so a page's wholesale save still passes; it only seeds the favorites store (./media/routes/favorites.ts).
  favorites: z.array(z.string()).optional(),
});
// Only `/preferences`, which the mpv player's `/player/*` routes above never shadow.
app.use(
  "/api",
  requireAuth,
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

// The module builder's "AI organize", with each account's own key, kept beside its preferences (./aiSettings.ts).
app.use(
  "/api/ai",
  aiOrganizeRouter(prefsStore(join(PREFS_DIR, "ai")), requireAuth),
);

// The old hosts, kept for saved links and installs: a page moves to k7's origin, under the alias's prefix; the API keeps answering.
const ALIASES: Record<string, string> = {
  "play.": "/media",
  "k7.": "/rehearsal",
};
app.use((req, res, next) => {
  if (
    !isLegacyHost(req.hostname) ||
    req.path.startsWith("/api") ||
    req.path.startsWith("/auth")
  )
    return next();
  const alias = Object.keys(ALIASES).find((h) => req.hostname.startsWith(h));
  const root = serviceUrl(`${req.protocol}://${req.hostname}`, "k7");
  const rest = req.originalUrl === "/" ? "" : req.originalUrl;
  res.redirect(301, `${root}${alias ? ALIASES[alias] : ""}${rest}`);
});

// The built SPA: a real file wins outright, then the shell for everything but /api and /auth, which 404 on their own.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
// The shell is asked again on every load and a hashed asset is kept for good — ../../../../docs/versioning.md.
const SHELL_CACHE = "no-cache";
// …or, in the dev tray, a running Vite in its place, for HMR on this origin (./devFrontend.ts).
const DEV_FRONTEND = process.env.K7_DEV_FRONTEND || "";
if (DEV_FRONTEND) app.use(devFrontend(DEV_FRONTEND));
else {
  app.use(
    precompressedStatic(FRONTEND_DIST, {
      setHeaders: (res, path) => {
        res.setHeader(
          "Cache-Control",
          path.startsWith(join(FRONTEND_DIST, "assets"))
            ? "public, max-age=31536000, immutable"
            : SHELL_CACHE,
        );
        if (path.endsWith(".html")) shellFrameHeaders(res);
      },
    }),
  );
  // Not for /assets/: a hashed chunk that is gone must 404, or the page parses index.html as a script.
  app.get(/^(?!\/api|\/auth|\/assets\/)/, (_req, res) => {
    res.setHeader("Cache-Control", SHELL_CACHE);
    shellFrameHeaders(res);
    res.sendFile(join(FRONTEND_DIST, "index.html"));
  });
}

// Mounted LAST: a JSON answer for every error, and never a 5xx's message or stack.
app.use(jsonErrorHandler);

const onListening = () => {
  const url = `http://${LISTEN_HOST ?? "localhost"}:${PORT}`;
  // "auth" and not "verifies auth": this backend MINTS the session (../../AGENTS.md).
  console.log(`🎛  k7 backend on ${url}  (auth + media library + rehearsal)`);
  media.serve(server, url);
  // After the library's serve: the rehearsal signaling sits in front of the registry's upgrade listener.
  rehearsal.serve();
  cameras.attach(server);
  localEngine?.start();
  // The servers paired before the engine followed its pairings, listed at the supervisor's first answer.
  if (localEngine && process.env.STUDIO_FILES_ROOT)
    listPairedOnce(localEngine, process.env.STUDIO_FILES_ROOT);
};
const server = behindProxy(createServer(app));
const listen = (): void => {
  if (LISTEN_HOST) server.listen(PORT, LISTEN_HOST, onListening);
  else server.listen(PORT, onListening);
};
// A standalone answers nothing before the bundled library is installed: its hosts call the first answer ready (./listenGate.ts).
if (LOCAL_USER)
  void awaitLibraries(media.librariesSettled(), (m) => console.log(m)).then(
    listen,
  );
else listen();
// Node's default cuts a request at 5 minutes, and a 512 MB upload over a slow link takes longer.
server.requestTimeout = 30 * 60_000;

// A stop lets the requests in flight finish, within the 10 s Docker allows before its SIGKILL.
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  console.log("stopping: the file services, then the requests in flight");
  setTimeout(() => process.exit(0), 8_000).unref();
  // The supervisor first: it deregisters from this backend, which must still be up to hear it.
  void (localEngine?.stop() ?? Promise.resolve())
    .catch((e) => console.error("supervisor stop:", e))
    .then(() =>
      Promise.all([
        media.stop().catch((e) => console.error("media stop:", e)),
        rehearsal.stop().catch((e) => console.error("rehearsal stop:", e)),
      ]),
    )
    .finally(() => server.close(() => process.exit(0)));
};
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
// Under the tray, stdin closing is the stop Windows has no signal for, and how a dead tray takes us down elsewhere.
const STDIN_STOP = ["K7_STDIN_STOP", "ELECTRON_SHELL_STDIN_STOP"];
if (STDIN_STOP.some((name) => process.env[name] === "1")) {
  for (const name of STDIN_STOP) delete process.env[name];
  process.stdin.on("end", stop);
  process.stdin.resume();
}
