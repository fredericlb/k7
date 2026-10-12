// mount.ts — the rehearsal recorder's routes, mounted inside st0's backend: sessions and moments,
// releases and their public pages, the songbook, the singing exercises, the phone-mic signaling.
// It mounts no auth, no body parser and no CORS: the host applies them to the whole process first.
// What reads wrong: it must be mounted BEFORE the media library, whose catch-all `/api` guard is
// session-only — the public pages are unguarded and the releases take k7's own bearer.

import type express from "express";
import { Router } from "express";
import { bearerOrSession } from "./apitoken.ts";
import { ensureSchema } from "./ensureSchema.ts";
import { env } from "./env.ts";
import type * as Declared from "./index.d.ts";
import { linkMediatek } from "./mediatek.ts";
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
import { startCacheSweeps } from "./store.ts";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
};

/** Answered as JSON, never Express's HTML page; an error-mode request that is not ours never reaches it. */
function jsonErrors(
  err: HttpError,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  const status =
    err.status ??
    err.statusCode ??
    (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res
    .status(status)
    .json({ error: status >= 500 ? "internal error" : err.message });
}

/** Mount every rehearsal route on `app`; call it after setupAuth and before the media library. */
export const mountRehearsal: typeof Declared.mountRehearsal = (app, opts) => {
  const { requireAuth } = opts;
  linkMediatek(opts.mediatek);

  // One router, so its error handler sees only the errors of the routes inside it.
  const api = Router();
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
  // GET only: st0's own `POST /api/token` and `GET /api/token/pair` fall through to the media library.
  api.use("/token", requireAuth, tokenRouter);
  api.use(jsonErrors);
  app.use("/api", api);

  let stopRtc: (() => void) | undefined;
  let stopSweeps: (() => void) | undefined;

  return {
    serve(server) {
      // A field schema.ts names but PocketBase lacks would swallow every write to it, so boot adds it.
      if (pocketbaseConfigured()) {
        console.log(
          `   rehearsal: PocketBase at ${env.pocketbase.url}, data in ${env.dataDir}`,
        );
        void ensureSchema((line) => {
          if (line.startsWith("✓")) console.log(`   PocketBase ${line}`);
        }).catch((err: unknown) =>
          console.error(
            `   ⚠️  PocketBase schema not reconciled: ${(err as Error).message}`,
          ),
        );
      } else
        console.log(
          "   ⚠️  rehearsal: PocketBase NOT configured — set POCKETBASE_* and run `npm run migrate -w @studio/rehearsal-server`",
        );
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
