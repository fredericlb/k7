import { createServer } from "node:http";
import { join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import express from "express";
import { bearerOrSession } from "./apitoken.ts";
import { ensureSchema } from "./ensureSchema.ts";
import { env } from "./env.ts";
import { isConfigured as pocketbaseConfigured } from "./pocketbase.ts";
import { configRouter } from "./routes/config.ts";
import { momentsRouter } from "./routes/moments.ts";
import { pagesRouter } from "./routes/pages.ts";
import { publicPagesRouter } from "./routes/publicPages.ts";
import { releasesRouter } from "./routes/releases.ts";
import { rtcRouter } from "./routes/rtc.ts";
import { sessionsRouter } from "./routes/sessions.ts";
import { singingRouter } from "./routes/singing.ts";
import { songsRouter } from "./routes/songs.ts";
import { tokenRouter } from "./routes/token.ts";
import { attachRtc } from "./rtc.ts";

const PORT = env.port;
const app = express();

app.use(express.json());

const { requireAuth } = await setupAuth(app, {
  // st0 mints the shared cookie and this only VERIFIES it — see ../../docs/routing.md.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "k7-backend",
});

app.use("/api/config", requireAuth, configRouter);
app.use("/api/sessions", requireAuth, sessionsRouter);
app.use("/api/moments", requireAuth, momentsRouter);
app.use("/api/releases", bearerOrSession(requireAuth), releasesRouter);
app.use("/api/pages", requireAuth, pagesRouter);
// No requireAuth: the nametag itself is the address — apps/k7/docs/ownership.md.
app.use("/api/public/pages", publicPagesRouter);
app.use("/api/songs", requireAuth, songsRouter);
app.use("/api/singing", requireAuth, singingRouter);
app.use("/api/rtc", requireAuth, rtcRouter);
app.use("/api/token", requireAuth, tokenRouter);

// The built SPA — this process's own frontend/dist, since there is no nginx in this image.
// Static files first (an asset request that matches a real file wins outright), then a
// catch-all SPA fallback for everything else EXCEPT /api and /auth, which answer their own
// 404 rather than being swallowed into the shell — this also covers `/@:nametag`, a public
// page's client-routed address, so a direct visit still gets the shell that renders it. This
// backend mounts neither (mountRoutes: [] for auth), and the frontend never asks it to
// answer either, but a 200-with-HTML is a worse failure than a clean 404 for anything that does.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
// The shell is asked again on every load and a hashed asset is kept for good — ../../../../docs/versioning.md.
const SHELL_CACHE = "no-cache";
app.use(
  express.static(FRONTEND_DIST, {
    setHeaders: (res, path) =>
      res.setHeader(
        "Cache-Control",
        path.startsWith(join(FRONTEND_DIST, "assets"))
          ? "public, max-age=31536000, immutable"
          : SHELL_CACHE,
      ),
  }),
);
app.get(/^(?!\/api|\/auth)/, (_req, res) => {
  res.setHeader("Cache-Control", SHELL_CACHE);
  res.sendFile(join(FRONTEND_DIST, "index.html"));
});

// The LAST handler: malformed JSON, an upload past its ceiling, a guard that failed — answered as JSON, never Express's HTML page with its stack.
app.use(
  (
    err: Error & { status?: number; statusCode?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      err.status ??
      err.statusCode ??
      (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.destroy();
    res
      .status(status)
      .json({ error: status >= 500 ? "internal error" : err.message });
  },
);

// A stray rejection is logged and survives; an uncaught exception leaves the process in an unknown state, so it is logged and the container restarts it.
process.on("unhandledRejection", (reason) =>
  console.error("unhandled rejection:", reason),
);
process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  process.exit(1);
});

// A field schema.ts names but PocketBase lacks would swallow every write to it, so boot adds it.
if (pocketbaseConfigured()) {
  await ensureSchema((line) => {
    if (line.startsWith("✓")) console.log(`   PocketBase ${line}`);
  }).catch((err: unknown) =>
    console.error(
      `   ⚠️  PocketBase schema not reconciled: ${(err as Error).message}`,
    ),
  );
}

const server = createServer(app);
// Node cuts a request off after 300 s; an hours-long take over a phone's uplink needs longer to arrive (docs/recordings.md).
server.requestTimeout = 30 * 60_000;
attachRtc(server);

// A stop lets the requests in flight finish — an upload among them — rather than waiting out the SIGKILL.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25_000).unref();
});

server.listen(PORT, () => {
  console.log(`🎙  k7 backend listening on http://localhost:${PORT}`);
  console.log(
    pocketbaseConfigured()
      ? `   PocketBase store configured (${env.pocketbase.url})`
      : "   ⚠️  PocketBase NOT configured — set POCKETBASE_* env vars and run `npm run migrate`",
  );
});
