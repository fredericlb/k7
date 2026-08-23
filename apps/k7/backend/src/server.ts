import { createServer } from "node:http";
import { setupAuth } from "@frediverse/oidc";
import express from "express";
import { bearerOrSession } from "./apitoken.ts";
import { env } from "./env.ts";
import { isConfigured as gristConfigured } from "./grist.ts";
import { momentsRouter } from "./routes/moments.ts";
import { pagesRouter } from "./routes/pages.ts";
import { releasesRouter } from "./routes/releases.ts";
import { rtcRouter } from "./routes/rtc.ts";
import { sessionsRouter } from "./routes/sessions.ts";
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

app.use("/api/sessions", requireAuth, sessionsRouter);
app.use("/api/moments", requireAuth, momentsRouter);
app.use("/api/releases", bearerOrSession(requireAuth), releasesRouter);
app.use("/api/pages", requireAuth, pagesRouter);
app.use("/api/songs", requireAuth, songsRouter);
app.use("/api/rtc", requireAuth, rtcRouter);
app.use("/api/token", requireAuth, tokenRouter);

const server = createServer(app);
attachRtc(server);

server.listen(PORT, () => {
  console.log(`🎙  k7 backend listening on http://localhost:${PORT}`);
  console.log(
    gristConfigured()
      ? `   Grist store configured (doc ${env.grist.docId})`
      : "   ⚠️  Grist NOT configured — set GRIST_* env vars and run `npm run migrate`",
  );
});
