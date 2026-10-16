// mount.ts — the media library's routes, mounted inside k7's backend: a folder on a volume
// scanned by @studio/mediatek, the shares, the hunt, the engine registry, the accounts' file hub,
// the host's mpv player and the stems. The filesystem is the index; the one exception is the
// comments on a share, which have many writers (../../docs/media/comments.md).
// It mounts no auth and no CORS: server.ts applies both to the whole process before calling this.
// A library token is valid only while listed in its store under the auth dir (../authState.ts).

import type { Server } from "node:http";
import { join } from "node:path";
import { apiTokenAuth, fileTokenStore } from "@frediverse/oidc/api-auth";
import { mountEngineRegistry } from "@studio/engine-registry";
import { ensureLayout, mediatekDir } from "@studio/mediatek/layout";
import { startRevisionRefresh } from "@studio/mediatek/revision";
import { configureMpv } from "@studio/mpv-player/player";
import { createPlayerRouter } from "@studio/mpv-player/router";
import type { Express, Request, RequestHandler } from "express";
import { authDir } from "../authState.ts";
import { emailOf, subOf } from "../who.ts";
import { isAdminRequest } from "./admin.ts";
import { startAnalysisSweep } from "./analysisSweep.ts";
import { mountFileHub, requireFilesRoot } from "./fileHub.ts";
import { startMp3Sweep } from "./mp3Sweep.ts";
import { engineLocalRouter } from "./routes/engineLocal.ts";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { mountServerCopy, serverOf } from "./routes/serverCopy.ts";
import { settingsRouter } from "./routes/settings.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";
import { SharePlayer } from "./shares/player.ts";
import { dropLegacyShares, sharesDir } from "./shares/store.ts";
import { mountTokenRoutes } from "./tokenRoutes.ts";
import { clearUploads, libraryUploads } from "./upload.ts";

/** The library's bearer scheme, created on its own so a mount BEFORE this one can be handed a token. */
export function mediaTokens(): ReturnType<typeof apiTokenAuth> {
  // A bearer stands in for the session: a service calling the library — the rehearsal server, an account's file service — has no cookie jar.
  return apiTokenAuth(
    process.env.API_TOKEN_SECRET || `${process.env.SESSION_SECRET ?? ""}:pl8`,
    { store: fileTokenStore(join(authDir(), "library-tokens.json")) },
  );
}

export interface MediaMount {
  /** Mint a library bearer for `sub` — what server.ts hands a service mounted beside this one. */
  issueApiToken(sub: string, opts?: { ephemeral?: boolean }): string;
  /** The boot work once the server listens: the volume's layout, the sweeps, the registry's relay. */
  serve(server: Server, url: string): void;
  /** Say goodbye to the registry and stop every account's file service; idempotent. */
  stop(): Promise<void>;
  /** The server the request's account is paired with, or null — where a desktop's releases and pages are. */
  pairedServer(req: Request): { base: string; token: string } | null;
}

/** Mount every media route on `app`; call it after setupAuth and before the SPA fallback. */
export function mountMedia(
  app: Express,
  opts: {
    requireAuth: RequestHandler;
    port: number;
    tokens: ReturnType<typeof mediaTokens>;
  },
): MediaMount {
  const { requireAuth, port, tokens } = opts;
  // Before anything listens: without it no project can open anywhere — packages/file-hub/docs/fileHub.md.
  const filesRoot = requireFilesRoot();

  const { issueApiToken, bearerOrSession } = tokens;

  // Everything is behind one of the two: a library is somebody's work, not a public bucket.
  app.use("/api/mediatek", bearerOrSession(requireAuth), libraryRouter);

  /** THE ONE PUBLIC SURFACE: unguarded, and mounted ABOVE the `/api` guard — ../../docs/media/shares.md. */
  app.use("/api/public/share", publicShareRouter());

  // The author's half of the same thing: uploading a share, listing them, taking one back.
  app.use(
    "/api/shares",
    bearerOrSession(requireAuth),
    sharesRouter(() => player.check()),
  );

  // Finding songs on Soulseek. SESSION ONLY: it spends somebody's account — ../../docs/media/hunt.md.
  app.use("/api/hunt", requireAuth, huntRouter);
  // …and the settings it spends — session only too, since they hold the slskd key (../../docs/media/settings.md).
  app.use("/api/settings", requireAuth, settingsRouter);

  // The studio's ONE engine registry; "pl8" is only its file name under ~/.k7/web-endpoints — ../../docs/media/engine.md.
  const engine = mountEngineRegistry(app, {
    service: "pl8",
    requireAuth,
    // server.ts owns the signals, so the goodbye runs before its graceful close.
    exitOnSignal: false,
    // On the volume, so an engine's id stays bound to its tunnel secret across a redeploy — packages/engine-registry/docs/token.md.
    stateDir: process.env.STUDIO_ENGINES_DIR || join(mediatekDir(), ".engines"),
    // Read when a heartbeat comes, by which time the hub below exists: a machine proves itself with its device token.
    deviceOf: (token) => fileHub?.deviceAccount(token) ?? null,
    // An admin may reset an engine's owner — packages/engine-registry/docs/ownership.md.
    isAdmin: isAdminRequest,
  });

  // A share is played by the server's engine, one session per visitor — ../../docs/media/sharePlayer.md.
  const player = new SharePlayer({
    tunnels: engine.tunnels,
    librariesHome: () => fileHub.libraries.home,
    mediatekDir,
  });

  // The accounts' workspaces, which live here and nowhere else — packages/file-hub/docs/fileHub.md.
  const fileHub = mountFileHub(
    app,
    engine,
    requireAuth,
    port,
    filesRoot,
    // Held in memory only: the service it is handed to dies with this process.
    (user) => issueApiToken(user, { ephemeral: true }),
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
    // Email first: mpv-player names each listener's socket directory after it.
    createPlayerRouter((req) => emailOf(req) ?? subOf(req) ?? ""),
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

  // Minted, listed and revoked by their owner, behind the session only (./tokenRoutes.ts).
  mountTokenRoutes(app, requireAuth, tokens);

  let stopping: Promise<void> | undefined;
  const stopHub = (): Promise<void> => {
    stopping ??= fileHub.stop();
    return stopping;
  };
  let bye: (() => void) | undefined;
  let stopPlayer: (() => void) | undefined;

  return {
    issueApiToken,
    pairedServer: (req) => serverOf(fileHub, req),
    serve(server, url) {
      // Created on boot, so an empty volume is a working library rather than a 404 until an upload.
      try {
        console.log(`   library: ${ensureLayout()}`);
        clearUploads(libraryUploads());
        clearUploads(join(sharesDir(), "uploads"));
        // Shares made before they were checkpoints cannot play: their links go — ../../docs/media/shares.md.
        const dropped = dropLegacyShares();
        if (dropped)
          console.log(`   shares: dropped ${dropped} frozen share(s)`);
        // A poll costs a map lookup from here on, and the walk that fills it runs off the loop.
        startRevisionRefresh();
        // …and the waveforms nobody has asked for yet, one at a time — ../../docs/media/analysis.md.
        startAnalysisSweep();
        // …and every FLAC's MP3 beside it, for a browser to stream — ../../docs/media/derivedMp3.md.
        startMp3Sweep();
      } catch (e) {
        console.error(
          `   library UNAVAILABLE at ${mediatekDir()}: ${(e as Error).message}`,
        );
      }
      // Advertised so this machine's file service finds the library; an engine joins only once its settings name this studio.
      bye = engine.serve(server, url, () => void stopHub());
      stopPlayer = player.attach(server);
      // Live sync's relay, which the account file services dial (packages/file-hub/docs/syncRelay.md).
      fileHub.serveSync(server);
    },
    async stop() {
      stopPlayer?.();
      bye?.();
      await stopHub();
    },
  };
}
