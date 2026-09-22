import { createServer } from "node:http";
import { join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import express from "express";
import { bearerOrSession } from "./apitoken.ts";
import { env } from "./env.ts";
import { isConfigured as pocketbaseConfigured } from "./pocketbase.ts";
import { momentsRouter } from "./routes/moments.ts";
import { pagesRouter } from "./routes/pages.ts";
import { publicPagesRouter } from "./routes/publicPages.ts";
import { releasesRouter } from "./routes/releases.ts";
import { rtcRouter } from "./routes/rtc.ts";
import { sessionsRouter } from "./routes/sessions.ts";
import { singingRouter } from "./routes/singing.ts";
import { songsRouter } from "./routes/songs.ts";
import { supernoteRouter } from "./routes/supernote.ts";
import { tokenRouter } from "./routes/token.ts";
import { attachRtc } from "./rtc.ts";
import { startSupernoteSchedule } from "./supernote/schedule.ts";

const PORT = env.port;
const app = express();

app.use(express.json());

const { requireAuth } = await setupAuth(app, {
  // st0 mints the shared cookie and this only VERIFIES it — see ../../docs/routing.md.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "k7-backend",
});

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
app.use("/api/supernote", requireAuth, supernoteRouter);

// The built SPA — this process's own frontend/dist, since there is no nginx in this image.
// Static files first (an asset request that matches a real file wins outright), then a
// catch-all SPA fallback for everything else EXCEPT /api and /auth, which answer their own
// 404 rather than being swallowed into the shell — this also covers `/@:nametag`, a public
// page's client-routed address, so a direct visit still gets the shell that renders it. This
// backend mounts neither (mountRoutes: [] for auth), and the frontend never asks it to
// answer either, but a 200-with-HTML is a worse failure than a clean 404 for anything that does.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api|\/auth)/, (_req, res) => {
  res.sendFile(join(FRONTEND_DIST, "index.html"));
});

const server = createServer(app);
attachRtc(server);
startSupernoteSchedule();

server.listen(PORT, () => {
  console.log(`🎙  k7 backend listening on http://localhost:${PORT}`);
  console.log(
    pocketbaseConfigured()
      ? `   PocketBase store configured (${env.pocketbase.url})`
      : "   ⚠️  PocketBase NOT configured — set POCKETBASE_* env vars and run `npm run migrate`",
  );
});
