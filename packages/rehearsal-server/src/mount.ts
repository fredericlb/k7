// mount.ts — the rehearsal recorder's routes, mounted inside k7's backend: sessions and moments,
// releases and their public pages, the songbook, the singing exercises, the phone-mic signaling.
// It mounts no auth, no body parser and no CORS: the host applies them to the whole process first.
// What reads wrong: it must be mounted BEFORE the media library, whose catch-all `/api` guard is
// session-only — the public pages are unguarded and the releases take k7's own bearer.

import { Router } from "express";
import { bearerOrSession } from "./apitoken.ts";
import { store } from "./db.ts";
import { env } from "./env.ts";
import { jsonErrors } from "./errors.ts";
import type * as Declared from "./index.d.ts";
import { linkMediatek } from "./mediatek.ts";
import { importFromPocketbase } from "./pocketbaseImport.ts";
import {
  forwardToServer,
  PUBLICATION_ROUTES,
  publicationsStatus,
} from "./publications.ts";
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
import { startCacheSweeps } from "./store.ts";

export { momentDeviceRouter, momentShareRouter } from "./momentShare.ts";
export {
  DEVICE_ROUTE as DEVICE_PUBLICATIONS_ROUTE,
  publicationsDeviceRouter,
} from "./publications.ts";
export { songbookCopyRouter, songbookDeviceRouter } from "./songbookCopy.ts";

/** Every path this package answers under `/api`: what waits for the import, and nothing else. */
const REHEARSAL_PATHS = [
  "/config",
  "/sessions",
  "/moments",
  "/releases",
  "/pages",
  "/public/pages",
  "/songs",
  "/singing",
  "/rtc",
  "/token",
  "/publications",
];

/** Mount every rehearsal route on `app`; call it after setupAuth and before the media library. */
export const mountRehearsal: typeof Declared.mountRehearsal = (app, opts) => {
  const { requireAuth } = opts;
  linkMediatek(opts.mediatek);

  // The rehearsal routes wait for the PocketBase import, so nothing is written into a store half filled.
  let ready: Promise<void> = Promise.resolve();
  let importFailed: string | null = null;
  const server = opts.server ?? (() => null);

  // One router, so its error handler sees only the errors of the routes inside it.
  const api = Router();
  api.get("/publications", publicationsStatus(server));
  // On a desktop or a phone, releases and pages are the paired server's, and wait on nothing local — ../docs/publications.md.
  if (env.instance === "local")
    api.use(PUBLICATION_ROUTES, requireAuth, forwardToServer(server));
  // Its own paths only: this router sits on `/api`, which the media library's routes share.
  api.use(REHEARSAL_PATHS, (_req, res, next) => {
    void ready.then(() =>
      importFailed ? res.status(503).json({ error: importFailed }) : next(),
    );
  });
  api.use("/config", requireAuth, configRouter);
  api.use("/sessions", requireAuth, sessionsRouter);
  api.use("/moments", requireAuth, momentsRouter);
  api.use("/releases", bearerOrSession(requireAuth), releasesRouter);
  api.use("/pages", requireAuth, pagesRouter);
  // No requireAuth: the nametag itself is the address — ../docs/ownership.md.
  api.use("/public/pages", publicPagesRouter);
  api.use("/songs", requireAuth, songsRouter);
  api.use("/singing", requireAuth, singingRouter);
  api.use("/rtc", requireAuth, rtcRouter);
  // GET only: k7's own `POST /api/token` and `GET /api/token/pair` fall through to the media library.
  api.use("/token", requireAuth, tokenRouter);
  api.use(jsonErrors);
  app.use("/api", api);

  let stopRtc: (() => void) | undefined;
  let stopSweeps: (() => void) | undefined;

  return {
    serve(server) {
      console.log(`   rehearsal: data in ${env.dataDir}`);
      // Once, while the store is empty and a PocketBase is named: the server's rows move out of it — ../docs/store.md.
      const pb = env.pocketbase;
      if (pb && store.isEmpty()) {
        console.log(`   rehearsal: importing from PocketBase at ${pb.url}…`);
        ready = importFromPocketbase(pb, store).then(
          (counts) =>
            console.log(
              `   rehearsal: imported ${Object.entries(counts)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ")}`,
            ),
          (err: unknown) => {
            importFailed = `the rehearsal store could not be imported from PocketBase: ${(err as Error).message}`;
            console.error(
              `   ⚠️  ${importFailed} — it is tried again at the next start`,
            );
          },
        );
      }
      // After the media library's serve: the registry's upgrade listener must already be there to sit behind this one.
      stopRtc = attachRtc(server);
      stopSweeps = startCacheSweeps();
    },
    async stop() {
      stopRtc?.();
      stopSweeps?.();
      stopRtc = stopSweeps = undefined;
    },
  };
};
