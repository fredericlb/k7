// mount.ts — the media library's routes, mounted inside k7's backend: a folder on a volume
// scanned by @studio/mediatek, the shares, the hunt, the engine registry, the accounts' file hub,
// the host's mpv player and the stems. The filesystem is the index; the one exception is the
// comments on a share, which have many writers (../../docs/media/comments.md).
// It mounts no auth and no CORS: server.ts applies both to the whole process before calling this.
// The bearer secret still ends in `:pl8`, so every token issued before stays valid.

import type { Server } from "node:http";
import { join } from "node:path";
import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import { mountEngineRegistry } from "@studio/engine-registry";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import { startRevisionRefresh } from "@studio/mediatek/revision";
import { configureMpv } from "@studio/mpv-player/player";
import { createPlayerRouter } from "@studio/mpv-player/router";
import { isLoopbackReturn } from "@studio/web-protocol/pairing";
import type { Express, Request, RequestHandler } from "express";
import { startAnalysisSweep } from "./analysisSweep.ts";
import { mountFileHub, requireFilesRoot } from "./fileHub.ts";
import { engineLocalRouter } from "./routes/engineLocal.ts";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { mountServerCopy, serverOf } from "./routes/serverCopy.ts";
import { settingsRouter } from "./routes/settings.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";
import { sharesDir } from "./shares/store.ts";
import { clearUploads, libraryUploads } from "./upload.ts";

/** The library's bearer scheme, created on its own so a mount BEFORE this one can be handed a token. */
export function mediaTokens(): ReturnType<typeof apiTokenAuth> {
  // A bearer stands in for the session: a service calling the library — the rehearsal server, an account's file service — has no cookie jar.
  return apiTokenAuth(
    process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:pl8`,
  );
}

export interface MediaMount {
  /** Mint a library bearer for `sub` — what server.ts hands a service mounted beside this one. */
  issueApiToken(sub: string): string;
  /** The boot work once the server listens: the volume's layout, the sweeps, the registry's relay. */
  serve(server: Server, url: string): void;
  /** Say goodbye to the registry and stop every account's file service; idempotent. */
  stop(): Promise<void>;
  /** The server the request's account is paired with, or null — where a desktop's releases and pages are. */
  pairedServer(req: Request): { base: string; token: string } | null;
}

type Who = { user?: { sub?: string; email?: string } };

/** Mount every media route on `app`; call it after setupAuth and before the SPA fallback. */
export function mountMedia(
  app: Express,
  opts: {
    requireAuth: RequestHandler;
    port: number;
    tokens?: ReturnType<typeof mediaTokens>;
  },
): MediaMount {
  const { requireAuth, port } = opts;
  // Before anything listens: without it no project can open anywhere — packages/file-hub/docs/fileHub.md.
  const filesRoot = requireFilesRoot();

  const { issueApiToken, bearerOrSession } = opts.tokens ?? mediaTokens();

  // Everything is behind one of the two: a library is somebody's work, not a public bucket.
  app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

  /** THE ONE PUBLIC SURFACE: unguarded, and mounted ABOVE the `/api` guard — ../../docs/media/shares.md. */
  app.use("/api/public/share", publicShareRouter());

  // The author's half of the same thing: uploading a snapshot, listing them, taking one back.
  app.use("/api/shares", bearerOrSession(requireAuth), sharesRouter());

  // Finding songs on Soulseek. SESSION ONLY: it spends somebody's account — ../../docs/media/hunt.md.
  app.use("/api/hunt", requireAuth, huntRouter);
  // …and the settings it spends — session only too, since they hold the slskd key (../../docs/media/settings.md).
  app.use("/api/settings", requireAuth, settingsRouter);

  // The studio's ONE engine registry; "pl8" is only its file name under ~/.k7/web-endpoints — ../../docs/media/engine.md.
  // server.ts owns the signals, so the goodbye runs before its graceful close.
  const engine = mountEngineRegistry(app, {
    service: "pl8",
    requireAuth,
    exitOnSignal: false,
  });

  // The accounts' workspaces, which live here and nowhere else — packages/file-hub/docs/fileHub.md.
  const fileHub = mountFileHub(
    app,
    engine,
    requireAuth,
    port,
    filesRoot,
    issueApiToken,
  );

  // A paired device reads this library and songbook by its token; its own backend places its copies against ours.
  mountServerCopy(app, fileHub, requireAuth);

  // Play on THIS host's outputs under a dot-directory no family scan sees — packages/mpv-player/docs/mpvPlayer.md.
  configureMpv({
    mediaRoot: mediatekDir,
    socketDir: () => join(mediatekDir(), ".player"),
  });
  // Guards every `/api` route mounted after it, so the unguarded ones above must stay above.
  app.use(
    "/api",
    bearerOrSession(requireAuth),
    createPlayerRouter((req) => {
      const who = (req as Who).user;
      return who?.email ?? who?.sub ?? "";
    }),
  );

  // Cutting a song into stems, driven from HERE because the bytes are here — ../../docs/media/stems.md.
  app.use(
    "/api/stems",
    bearerOrSession(requireAuth),
    stemsRouter(engine, (user, chain, want) =>
      fileHub.coldRun(user, chain, want),
    ),
  );

  // Where a song is on an engine's machine, fetched there first — what the player hands the engine.
  app.use("/api/engine-local", requireAuth, engineLocalRouter(engine));

  // A token for a DESKTOP app on its loopback port; isLoopbackReturn IS this route's security.
  app.get("/api/token/pair", requireAuth, (req, res) => {
    const back = String(req.query.return ?? "");
    // The predicate is shared with the app that builds this address: one rule, two sides.
    if (!isLoopbackReturn(back))
      return res
        .status(400)
        .json({ error: "return must be an http loopback address" });
    const target = new URL(back);

    const who = (req as Who).user;
    const id = who?.sub ?? who?.email;
    if (!id) return res.status(401).json({ error: "no user on the session" });

    target.searchParams.set("token", issueApiToken(id));
    target.searchParams.set("identity", who?.email ?? id);
    if (typeof req.query.state === "string")
      target.searchParams.set("state", req.query.state);
    res.redirect(target.toString());
  });

  /** Mint a token for the signed-in user. Session only: a token must not mint another. */
  app.post("/api/token", requireAuth, (req, res) => {
    const who = (req as Who).user;
    const id = who?.sub ?? who?.email;
    if (!id) return res.status(401).json({ error: "no user on the session" });
    res.json({ token: issueApiToken(id) });
  });

  let stopping: Promise<void> | undefined;
  const stopHub = (): Promise<void> => {
    stopping ??= fileHub.stop();
    return stopping;
  };
  let bye: (() => void) | undefined;

  return {
    issueApiToken,
    pairedServer: (req) => serverOf(fileHub, req),
    serve(server, url) {
      // Created on boot, so an empty volume is a working library rather than a 404 until an upload.
      try {
        console.log(`   library: ${ensureLayout()}`);
        clearUploads(libraryUploads());
        clearUploads(join(sharesDir(), "uploads"));
        // A poll costs a map lookup from here on, and the walk that fills it runs off the loop.
        startRevisionRefresh();
        // …and the waveforms nobody has asked for yet, one at a time — ../../docs/media/analysis.md.
        startAnalysisSweep();
      } catch (e) {
        console.error(
          `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
        );
      }
      // Advertised so this machine's file service finds the library; an engine joins only once its settings name this studio.
      bye = engine.serve(server, url, () => void stopHub());
      // Live sync's relay, which the account file services dial (packages/file-hub/docs/syncRelay.md).
      fileHub.serveSync(server);
    },
    async stop() {
      bye?.();
      await stopHub();
    },
  };
}
