// server.ts — the hosted media library. A folder on a volume, scanned by @studio/mediatek
// and served over HTTP: the same vocabulary the local service speaks, so the machine that
// caches it asks both sides the same questions. No database — see the package's docs/index.md.

import { setupAuth } from "@frediverse/oidc";
import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import { createRegistry, engineRegistryRouter } from "@studio/engine-registry";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import express from "express";
import { libraryRouter } from "./routes/library.ts";
import { mirrorRouter } from "./routes/mirror.ts";

const PORT = Number(process.env.PORT || 8795);

// The volume. Required, not defaulted: @studio/mediatek falls back to ~/.lanes/mediatek,
// which inside a container is an empty directory nobody mounted — the service would come
// up healthy and serve an empty library, which is the worst possible failure here.
if (!process.env.LANES_MEDIATEK) {
  console.error(
    "error: LANES_MEDIATEK is not set — it must point at the mounted library volume.",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const { requireAuth } = await setupAuth(app, {
  cookieName: "mediatek.sid",
  service: "mediatek-backend",
});

// A bearer token stands in for the session, because the main consumer has no cookie jar:
// the LOCAL service syncing a cache runs headless beside the engine. Same scheme radiok7
// already uses for the lanes CLI — a signed {sub,iat}, no server-side storage, rotate the
// secret to revoke everything.
const { issueApiToken, bearerOrSession } = apiTokenAuth(
  process.env.API_TOKEN_SECRET ||
    `${process.env.SESSION_SECRET ?? ""}:mediatek`,
);

// Everything is behind one of the two: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

// SESSION only, unlike the library routes. A pull reaches into another system and rewrites
// a family; a token exists so a headless cache can READ, and widening it to this would let
// a leaked one repopulate somebody's library from a Grist document they never chose.
app.use("/api/mirror", requireAuth, mirrorRouter);

// This service's OWN engine registry. Until now a module preview was hardcoded to
// ws://127.0.0.1:8765, so "which engine" had no question to answer here — and no answer to
// offer either. Same mounting rule as lanes: the browser routes need a session, the
// engine-facing heartbeat stays open because a machine authenticates with its own token.
app.use(["/api/engines", "/api/engine"], requireAuth);
app.use("/api", engineRegistryRouter(createRegistry()));

/** Mint a token for the signed-in user — what you paste into a machine's settings once.
 *  Session only, deliberately: a token must not be able to mint another. */
app.post("/api/token", requireAuth, (req, res) => {
  const sub = (req as { user?: { sub?: string; email?: string } }).user;
  const id = sub?.sub ?? sub?.email;
  if (!id) return res.status(401).json({ error: "no user on the session" });
  res.json({ token: issueApiToken(id) });
});

app.listen(PORT, () => {
  // Created on boot like the local service does, so an empty volume is a working library
  // rather than a 404 until someone uploads.
  try {
    console.log(`📚 mediatek backend on :${PORT}`);
    console.log(`   library: ${ensureLayout()}`);
  } catch (e) {
    console.error(
      `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
    );
  }
});
