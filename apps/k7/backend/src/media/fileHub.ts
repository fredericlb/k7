// fileHub.ts — the media side hosts the accounts' WORKSPACES under `$STUDIO_FILES_ROOT`: one file service per
// account, beside the registry whose tunnels reach the engines that play them. It is the only place
// a workspace lives, so a backend without it refuses to start rather than serve an origin where no
// project can open. See packages/file-hub/docs/fileHub.md.

import type { SessionUser } from "@frediverse/oidc";
import type { EngineMount } from "@studio/engine-registry";
import {
  FILE_HUB_HELLO,
  FILE_HUB_INTERNAL,
  FILE_HUB_PATH,
  FileHub,
  type FileHubOptions,
  PUBLIC_LIBRARIES_PATH,
} from "@studio/file-hub";
import { mediatekDir } from "@studio/mediatek/layout";
import {
  SYNC_PAIR_DIRECT_ROUTE,
  SYNC_PAIR_RETURN_PATH,
  SYNC_PAIR_ROUTE,
} from "@studio/web-protocol/pairing";
import express, { type Express, type RequestHandler } from "express";
import { emailOf, subOf } from "../who.ts";
import { isAdminRequest } from "./admin.ts";

/** `$STUDIO_FILES_ROOT`, or the process exits with what to set — called before anything listens. */
export function requireFilesRoot(): string {
  const dataRoot = process.env.STUDIO_FILES_ROOT?.trim();
  if (dataRoot) return dataRoot;
  console.error(
    "✗ $STUDIO_FILES_ROOT is not set — it is where the accounts' workspaces live, and there is no other place.\n" +
      "  Set it to a writable folder (env.yaml's k7-backend in dev, the compose file in production).",
  );
  process.exit(1);
}

export function mountFileHub(
  app: Express,
  engine: EngineMount,
  requireAuth: RequestHandler,
  port: number,
  dataRoot: string,
  issueApiToken: (sub: string) => string,
  onRemote?: FileHubOptions["onRemote"],
  directPair?: FileHubOptions["directPair"],
): FileHub {
  const hub = new FileHub({
    dataRoot,
    mediatekRoot: mediatekDir(),
    // Each account's service calls THIS process back over loopback, as that account.
    mediatekLink: (user) => ({
      url: `http://127.0.0.1:${port}`,
      token: issueApiToken(user),
    }),
    registry: engine.registry,
    tunnels: engine.tunnels,
    selfPort: () => port,
    userOf: (req) => emailOf(req) ?? "",
    subjectOf: (req) => subOf(req) ?? "",
    // Who may edit the origin's libraries: the `groups` claim against this list, which empty admits nobody.
    isAdmin: isAdminRequest,
    // Set by `npm run dev` only: this process's own watch cannot see the ones it spawns.
    watchSources: process.env.STUDIO_FILES_WATCH === "1",
    // The tray and the phones follow a main server; a server stays its accounts' main one, others beside it (docs/fileHub.md).
    remotePairing: process.env.STUDIO_LOCAL_USER === "1",
    // One person and no account competing for memory: their service is never stopped for being idle (../../docs/media/projects.md).
    idleMs:
      process.env.STUDIO_LOCAL_USER === "1"
        ? Number.POSITIVE_INFINITY
        : undefined,
    isLocal: (req) => (req.user as SessionUser | undefined)?.local === true,
    // A pairing page's "Use another account": the gate then signs the browser in again (packages/file-hub/docs/syncRelay.md).
    signOut: (req) => {
      req.session = null;
    },
    // Under the tray, the machine's engine follows each pairing (../localEngine/followPairings.ts).
    onRemote,
    // Pairing with no browser for an account signed in to the provider (./directPair.ts).
    directPair,
    // Stable across restarts, so an open page keeps its ticket through a deploy.
    ticketKey: process.env.SESSION_SECRET
      ? `${process.env.SESSION_SECRET}:files`
      : undefined,
  });
  app.get(FILE_HUB_HELLO, requireAuth, hub.helloHandler());
  // The published versions of the seed's library, for a desktop never paired: no session, read-only.
  app.use(PUBLIC_LIBRARIES_PATH, hub.publicLibrariesHandler());
  // A machine or another server pairing with this one: its browser lands here, signs in if it must, and leaves with a device token.
  const pairGate: RequestHandler = (req, res, next) => {
    const user = req.session?.user as SessionUser | undefined;
    if (!user || user.local)
      return res.redirect(
        // A pairing that lets the person choose the account asks the provider for its sign-in page, not its session's account.
        `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}${req.query.choose === "1" ? "&prompt=login" : ""}`,
      );
    (req as { user?: SessionUser }).user = user;
    next();
  };
  app.get(SYNC_PAIR_ROUTE, pairGate, hub.sync.syncPairHandler());
  // The confirm another server's pairing asks for, posted by the page the GET served.
  app.post(
    SYNC_PAIR_ROUTE,
    express.urlencoded({ extended: false, limit: "8kb" }),
    pairGate,
    hub.sync.syncPairHandler(),
  );
  // A machine's backend with its provider token, server to server: no session, the provider's word is the gate.
  const direct = hub.sync.directPairHandler();
  if (direct)
    app.post(SYNC_PAIR_DIRECT_ROUTE, express.json({ limit: "4kb" }), direct);
  app.use("/api/sync/devices", requireAuth, hub.sync.devicesRouter());
  // A pairing through the browser, for the tray, the phones and a server's accounts: started and awaited here, ended at the return.
  app.use("/api/sync/remote/pair", requireAuth, hub.sync.pairRouter());
  // The browser comes back here with the origin's token, signed in to nothing on this machine: the state is the gate.
  app.get(SYNC_PAIR_RETURN_PATH, hub.sync.pairReturnHandler());
  // The account's pairings with other servers: what pairing brought back, listed, made main or let go.
  app.use("/api/sync/remote", requireAuth, hub.sync.remoteRouter());
  // A binary file's bytes, by hash: a device token or a hub secret is the gate, not a session.
  app.use("/api/sync/blobs", hub.sync.blobsRouter());
  // The workspaces an account syncs, for a replica that has not seen them all; same gate as the blobs.
  app.use("/api/sync/rooms", hub.sync.roomsRouter());
  // The account's sync history, for its own browser.
  app.use("/api/sync/history", requireAuth, hub.sync.historyRouter());
  // Change notices for the account's open pages, pushed as the relay orders entries.
  app.use("/api/sync/events", requireAuth, hub.sync.eventsRouter());
  // Called only by this hub's own file services, over loopback: their secret is the gate, not a session.
  app.use(FILE_HUB_INTERNAL, hub.internalHandler());
  // No session guard: a page on another origin carries a ticket, not a cookie — the hub checks it.
  app.use(FILE_HUB_PATH, hub.handler());
  console.log(`   workspaces: hosted under ${dataRoot}`);
  return hub;
}
