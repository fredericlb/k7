// server.ts — the hosted media library. A folder on a volume, scanned by @studio/mediatek
// and served over HTTP: the same vocabulary the local service speaks, so the machine that
// caches it asks both sides the same questions. No database — see the package's docs/index.md.

import { setupAuth } from "@frediverse/oidc";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import express from "express";
import { libraryRouter } from "./routes/library.ts";

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

// Everything is behind the session: a library is somebody's work, not a public bucket.
app.use("/api/mediatek", requireAuth, libraryRouter);

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
