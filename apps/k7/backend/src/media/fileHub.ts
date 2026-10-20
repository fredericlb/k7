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
  PUBLIC_LIBRARIES_PATH,
} from "@studio/file-hub";
import { mediatekDir } from "@studio/mediatek/layout";
import {
  SYNC_PAIR_RETURN_PATH,
  SYNC_PAIR_ROUTE,
} from "@studio/web-protocol/pairing";
import type { Express, RequestHandler } from "express";
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
    // The desktop and the phone pair with an origin; the origin itself never follows another (docs/fileHub.md).
    remotePairing: process.env.STUDIO_LOCAL_USER === "1",
    isLocal: (req) => (req.user as SessionUser | undefined)?.local === true,
    // Stable across restarts, so an open page keeps its ticket through a deploy.
    ticketKey: process.env.SESSION_SECRET
      ? `${process.env.SESSION_SECRET}:files`
      : undefined,
  });
  app.get(FILE_HUB_HELLO, requireAuth, hub.helloHandler());
  // The published versions of the seed's library, for a desktop never paired: no session, read-only.
  app.use(PUBLIC_LIBRARIES_PATH, hub.publicLibrariesHandler());
  // A desktop pairing with this origin: its browser lands here, signs in if it must, and leaves with a device token.
  app.get(
    SYNC_PAIR_ROUTE,
    (req, res, next) => {
      const user = req.session?.user as SessionUser | undefined;
      if (!user || user.local)
        return res.redirect(
          `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`,
        );
      (req as { user?: SessionUser }).user = user;
      next();
    },
    hub.sync.syncPairHandler(),
  );
  app.use("/api/sync/devices", requireAuth, hub.sync.devicesRouter());
  // A pairing through the browser, for the desktop and the phones: started and awaited here, ended at the return.
  app.use("/api/sync/remote/pair", requireAuth, hub.sync.pairRouter());
  // The browser comes back here with the origin's token, signed in to nothing on this machine: the state is the gate.
  app.get(SYNC_PAIR_RETURN_PATH, hub.sync.pairReturnHandler());
  // The LOCAL backend's own account, paired with a remote origin: the desktop stores what pairing brought back.
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
