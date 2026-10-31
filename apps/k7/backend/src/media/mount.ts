// mount.ts — the media library's routes, mounted inside k7's backend: a folder on a volume
// scanned by @studio/mediatek, the shares, the hunt, the engine registry, the accounts' file hub,
// and the stems. The filesystem is the index; the one exception is the
// comments on a share, which have many writers (../../docs/media/comments.md).
// It mounts no auth and no CORS: server.ts applies both to the whole process before calling this.
// A library token is valid only while listed in its store under the auth dir (../authState.ts).

import type { Server } from "node:http";
import { join } from "node:path";
import { apiTokenAuth, fileTokenStore } from "@frediverse/oidc/api-auth";
import { mountEngineRegistry } from "@studio/engine-registry";
import type { FileHub } from "@studio/file-hub";
import {
  ensureLayout,
  MediatekTooNewError,
  mediatekDir,
} from "@studio/mediatek/layout";
import { startRevisionRefresh } from "@studio/mediatek/revision";
import type { Express, Request, RequestHandler } from "express";
import { authDir } from "../authState.ts";
import { isAdminRequest } from "./admin.ts";
import { nudgeAnalysisSweep, startAnalysisSweep } from "./analysisSweep.ts";
import { mountFileHub, requireFilesRoot } from "./fileHub.ts";
import { engineLocalRouter } from "./routes/engineLocal.ts";
import {
  DEVICE_FAVORITES_ROUTE,
  DEVICE_PRACTICE_ROUTE,
  type FavoriteStores,
  favoritesDeviceRouter,
  favoritesRouter,
} from "./routes/favorites.ts";
import { huntRouter } from "./routes/hunt.ts";
import { libraryRouter } from "./routes/library.ts";
import { publicShareRouter } from "./routes/publicShare.ts";
import { mountServerCopy, serverOf } from "./routes/serverCopy.ts";
import { settingsRouter } from "./routes/settings.ts";
import { sharesRouter } from "./routes/shares.ts";
import { stemsRouter } from "./routes/stems.ts";
import { machineServers } from "./serverSongs/server.ts";
import { startSongUpdates } from "./serverSongs/updates.ts";
import { SharePlayer } from "./shares/player.ts";
import { dropLegacyShares, sharesDir } from "./shares/store.ts";
import { startStreamSweep } from "./streamSweep.ts";
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
  pairedServer(
    req: Request,
  ): { base: string; token: string; account?: string } | null;
  /** Who a device token signs in as through the device door (../remote/door.ts), or null. */
  deviceUser(token: string): { email: string; person: string } | null;
  /** Start the account's file service ahead of its first request: a signed-in page, or a standalone's boot. */
  warmFiles(user: string): void;
  /** How full the accounts' file hub is, for the readiness probe (../readiness.ts). */
  fileStatus(): ReturnType<FileHub["status"]>;
  /** The hub's first library ensure, started on the first call: what a standalone waits for before it listens (../listenGate.ts). */
  librariesSettled(): ReturnType<FileHub["libraries"]["firstEnsure"]>;
}

/** A phone or the tray: one person, and an engine sharing the device, so the library's background work waits to be wanted. */
const STANDALONE = process.env.STUDIO_LOCAL_USER === "1";
/** On a standalone host, the change tokens stop being walked once nobody read one for this long. */
const REVISION_IDLE_MS = 60_000;

/** Mount every media route on `app`; call it after setupAuth and before the SPA fallback. */
export function mountMedia(
  app: Express,
  opts: {
    requireAuth: RequestHandler;
    port: number;
    tokens: ReturnType<typeof mediaTokens>;
    /** Under the tray: what the machine's engine does as a pairing is stored or let go. */
    onRemote?: Parameters<typeof mountFileHub>[6];
    /** Where each account's médiathèque favorites are kept (./routes/favorites.ts). */
    favorites: FavoriteStores;
    /** …and its practice list, the same kind of list under its own name. */
    practice: FavoriteStores;
  },
): MediaMount {
  const { requireAuth, port, tokens } = opts;
  // Before anything listens: without it no project can open anywhere — packages/file-hub/docs/fileHub.md.
  const filesRoot = requireFilesRoot();

  const { issueApiToken, bearerOrSession } = tokens;

  // Set at boot when the volume holds a library a newer k7 wrote; the library's routes then answer 503 (packages/mediatek/docs/index.md).
  let tooNew: MediatekTooNewError | undefined;
  const refuseTooNew: RequestHandler = (_req, res, next) => {
    if (!tooNew) return next();
    const { message: error, code, libraryVersion, buildVersion } = tooNew;
    res.status(503).json({ error, code, libraryVersion, buildVersion });
  };

  // Everything is behind one of the two: a library is somebody's work, not a public bucket.
  app.use(
    "/api/mediatek",
    bearerOrSession(requireAuth),
    refuseTooNew,
    (_req, _res, next) => {
      nudgeAnalysisSweep();
      next();
    },
    libraryRouter,
  );

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
    // Read when a heartbeat comes, by which time the hub below exists: a device token names the engine's owner.
    deviceOf: (token) => fileHub?.deviceEmail(token) ?? null,
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
    opts.onRemote,
  );

  // A paired device reads this library and songbook by its token; its own backend places its copies against ours.
  const servers = () => machineServers(filesRoot);
  mountServerCopy(app, fileHub, requireAuth, servers);
  // The account's favorites: a paired machine's are its server's, read through the device door.
  app.use(
    DEVICE_FAVORITES_ROUTE,
    favoritesDeviceRouter(fileHub.sync.deviceGate(), opts.favorites),
  );
  app.use(
    "/api/favorites",
    requireAuth,
    favoritesRouter(opts.favorites, (req) => serverOf(fileHub, req)),
  );
  // The practice list: the same list, the same doors, its own name — ../../docs/media/practice.md.
  const practice: FavoriteStores = {
    ...opts.practice,
    key: "practice",
    deviceRoute: DEVICE_PRACTICE_ROUTE,
  };
  app.use(
    DEVICE_PRACTICE_ROUTE,
    favoritesDeviceRouter(fileHub.sync.deviceGate(), practice),
  );
  app.use(
    "/api/practice",
    requireAuth,
    favoritesRouter(practice, (req) => serverOf(fileHub, req)),
  );

  // Guards every `/api` route mounted after it, so the unguarded ones above must stay above.
  app.use("/api", bearerOrSession(requireAuth));

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
    deviceUser: (token) => fileHub.deviceUser(token),
    warmFiles: (user) => fileHub.warm(user),
    fileStatus: () => fileHub.status(),
    librariesSettled: () => fileHub.libraries.firstEnsure(),
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
        // A poll costs a map lookup from here on, and the walk that fills it runs off the loop; a standalone pauses it unread.
        startRevisionRefresh(
          undefined,
          STANDALONE ? REVISION_IDLE_MS : undefined,
        );
        // …and the waveforms nobody has asked for yet, one at a time; a standalone waits for the library to be opened — ../../docs/media/analysis.md.
        startAnalysisSweep(STANDALONE);
        // …and every FLAC's Opus copy beside it, for a browser to stream — ../../docs/media/derivedStream.md.
        startStreamSweep();
        // A machine keeps the songs that follow its server in step, at start and every half hour (../../docs/media/songUpdates.md).
        if (STANDALONE) startSongUpdates(servers);
      } catch (e) {
        if (e instanceof MediatekTooNewError) tooNew = e;
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
