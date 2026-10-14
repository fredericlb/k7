// server.ts — the studio's hosted backend: the origin's OIDC flow (it MINTS the session every
// studio app verifies), the account's preferences, the rehearsal recorder (@studio/rehearsal-server),
// the media library and its engine registry (./media/mount.ts), and the built SPA — docker/ ships
// no nginx. `play.` and `k7.` are aliases: a page there goes to `/media` or `/rehearsal` at the root.
// Rehearsal is mounted BEFORE the library: the library's catch-all `/api` guard would swallow it.
// The registry installs no signal handler here: the stop below says its goodbye, then closes gracefully.
// Runs under tsx to import the brain's TS.

import { homedir } from "node:os";
import { join } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { precompressedStatic } from "@frediverse/http/precompressed";
import { behindProxy } from "@frediverse/http/proxied";
import { setupAuth } from "@frediverse/oidc";
import { ENGINE_BODY_LIMIT, engineErrorHandler } from "@studio/engine-registry";
import { mountRehearsal } from "@studio/rehearsal-server";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import { serviceUrl } from "@studio/web-protocol/services";
import express from "express";
import { z } from "zod";
import { aiOrganizeBody, aiOrganizeRouter } from "./aiOrganize";
import { mountHandoff } from "./handoff.ts";
import { openCors } from "./media/cors.ts";
import { mediaTokens, mountMedia } from "./media/mount.ts";

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

const PORT = Number(process.env.PORT || 8789);
const app = express();

// Every origin's preflight is answered before anything else runs — ../docs/media/cors.md.
app.use(openCors);
// The module builder's AI organize takes a whole module, so it parses first, with its own limit.
app.use("/api/ai", aiOrganizeBody);
// The relay pipes bodies to an engine's file service, so the limit is that service's opinion.
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

// Empty stays undefined, not []: setupAuth falls back on nullish only, and [] asks for NO scopes.
const scopes = (process.env.OIDC_SCOPES ?? "")
  .split(/[\s,]+/)
  .filter((s) => s !== "");

// This backend OWNS /auth/* for the whole origin, being the service with no prefix (../../AGENTS.md).
const { requireAuth } = await setupAuth(app, {
  cookieName: "studio.sid",
  // The env.yaml section, which is the PACKAGE name here as everywhere else.
  service: "k7-backend",
  // Dropping `groups` would 403 every z0 admin surface — see ../../AGENTS.md, § The backend in detail.
  ...(scopes.length > 0 ? { scopes } : {}),
});
// An app's system-browser sign-in, and the desktop's signed-out local user (../docs/handoff.md).
mountHandoff(app, {
  secret: process.env.SESSION_SECRET || "dev-insecure-secret-change-me",
  localUser: process.env.STUDIO_LOCAL_USER === "1",
});

// The library's tokens first, so the rehearsal server, mounted ahead of it, can call it with one.
const tokens = mediaTokens();
// Before the library: its public pages are unguarded and its releases take k7's own bearer.
const rehearsal = mountRehearsal(app, {
  requireAuth,
  // Asked per request, so it is the media mount's once that exists: a desktop's releases are its server's.
  server: (req) => media.pairedServer(req),
  mediatek: {
    base: `http://127.0.0.1:${PORT}`,
    token: tokens.issueApiToken("service:k7"),
  },
});
// Mounted before the prefs below: their `/api` guard is session-only, and a bearer or a ticket must reach these first.
const media = mountMedia(app, { requireAuth, port: PORT, tokens });

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
});
// Under the home directory so a dev run needs no volume (packages/user-prefs/docs/store.md).
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "k7");
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

// The old hosts, kept for saved links and installs: a page moves under its prefix at the family root; the API keeps answering.
const ALIASES: Record<string, string> = {
  "play.": "/media",
  "k7.": "/rehearsal",
};
app.use((req, res, next) => {
  const alias = Object.keys(ALIASES).find((h) => req.hostname.startsWith(h));
  if (
    !alias ||
    req.path.startsWith("/api") ||
    req.path.startsWith("/auth") ||
    req.path === "/rtc"
  )
    return next();
  const root = serviceUrl(`${req.protocol}://${req.hostname}`, "k7");
  const rest = req.originalUrl === "/" ? "" : req.originalUrl;
  res.redirect(301, `${root}${ALIASES[alias]}${rest}`);
});

// The built SPA: a real file wins outright, then the shell for everything but /api and /auth, which 404 on their own.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
// The shell is asked again on every load and a hashed asset is kept for good — ../../../../docs/versioning.md.
const SHELL_CACHE = "no-cache";
app.use(
  precompressedStatic(FRONTEND_DIST, {
    setHeaders: (res, path) =>
      res.setHeader(
        "Cache-Control",
        path.startsWith(join(FRONTEND_DIST, "assets"))
          ? "public, max-age=31536000, immutable"
          : SHELL_CACHE,
      ),
  }),
);
// Not for /assets/: a hashed chunk that is gone must 404, or the page parses index.html as a script.
app.get(/^(?!\/api|\/auth|\/assets\/)/, (_req, res) => {
  res.setHeader("Cache-Control", SHELL_CACHE);
  res.sendFile(join(FRONTEND_DIST, "index.html"));
});

// Mounted LAST: three routes read a 512 MB body, so a caller hanging up is an everyday event.
app.use(engineErrorHandler);

const server = behindProxy(
  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    // "auth" and not "verifies auth": this backend MINTS the session (../../AGENTS.md).
    console.log(`🎛  k7 backend on ${url}  (auth + media library + rehearsal)`);
    media.serve(server, url);
    // After the library's serve: the rehearsal signaling sits in front of the registry's upgrade listener.
    rehearsal.serve(server);
  }),
);
// Node's default cuts a request at 5 minutes, and a 512 MB upload over a slow link takes longer.
server.requestTimeout = 30 * 60_000;

// A stop lets the requests in flight finish, within the 10 s Docker allows before its SIGKILL.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    console.log("stopping: the file services, then the requests in flight");
    setTimeout(() => process.exit(0), 8_000).unref();
    void Promise.all([
      media.stop().catch((e) => console.error("media stop:", e)),
      rehearsal.stop().catch((e) => console.error("rehearsal stop:", e)),
    ]).finally(() => server.close(() => process.exit(0)));
  });
