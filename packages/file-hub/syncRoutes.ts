// syncRoutes.ts — the hub's live-sync routes beside the relay: devices and their pairing, a local account's
// pairing with a remote origin, the rooms an account has, the blob store and the history.
// Split from index.ts, which keeps the file services and the relay itself. See docs/syncRelay.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isLoopbackReturn } from "@studio/web-protocol/pairing";
import express, { type Request, type RequestHandler, Router } from "express";
import { blobsRouter } from "./blobStore.ts";
import type { DeviceTokens } from "./deviceTokens.ts";
import { historyRouter } from "./historyRoutes.ts";
import { accountKey, type Instances } from "./instances.ts";
import { LIBRARIES_ACCOUNT } from "./libraryRelay.ts";
import { roomsRouter, syncCredential } from "./roomsRoute.ts";
import { eventsRouter } from "./syncEvents.ts";
import type { attachSyncRelay } from "./syncRelay.ts";
import { SYNC_PATH } from "./syncRelay.ts";
import {
  forgetRemote,
  readRemote,
  readRemotes,
  type SyncRemote,
  setMainRemote,
  writeRemote,
} from "./syncRemote.ts";

/** Who passed `deviceGate`: the account, the person who paired the device when its token says (older ones do not), the device's name. */
export interface SyncCaller {
  slug: string;
  person: string | null;
  /** The name the device was paired under; null for a hub secret. */
  device: string | null;
}

/** What the sync routes need of the hub. */
export interface SyncContext {
  dataRoot: string;
  librariesHome: string;
  librarySecret: string;
  devices: DeviceTokens;
  instances: Instances;
  userOf: (req: Request) => string;
  /** The session's OIDC subject, carried in a device token minted from it. */
  subjectOf: (req: Request) => string;
  /** The running relay, once `serveSync` has attached it. */
  relay: () => ReturnType<typeof attachSyncRelay> | null;
  /** Whether an account here may be paired with a remote origin: the desktop and the phone, never the origin itself. */
  remotePairing: boolean;
}

/** The host a browser reached this origin at: a proxy in front rewrites Host, and says the original in x-forwarded-host. */
const publicHost = (req: Request): string =>
  String(req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();

export class SyncRoutes {
  constructor(private readonly c: SyncContext) {}

  /** The account's sync devices: list, add (answering the token once), remove — mounted behind the session guard. */
  devicesRouter(): Router {
    const r = Router();
    r.use(express.json());
    const slugOf = (req: Request): string | null => {
      const user = this.c.userOf(req);
      return user ? accountKey(user) : null;
    };
    r.get("/", (req, res) => {
      const slug = slugOf(req);
      if (!slug) res.status(401).json({ error: "no user on the session" });
      else res.json({ devices: this.c.devices.list(slug) });
    });
    r.post("/", (req, res) => {
      const slug = slugOf(req);
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!slug)
        return void res.status(401).json({ error: "no user on the session" });
      if (!name)
        return void res.status(400).json({ error: "a device needs a name" });
      const { device, token } = this.c.devices.mint(
        slug,
        name,
        this.c.subjectOf(req),
      );
      const proto = req.get("x-forwarded-proto") ?? req.protocol;
      const url = `${proto === "https" ? "wss" : "ws"}://${publicHost(req)}${SYNC_PATH}`;
      res.json({ device, token, url });
    });
    r.delete("/:id", (req, res) => {
      const slug = slugOf(req);
      if (!slug)
        return void res.status(401).json({ error: "no user on the session" });
      res.json({ removed: this.c.devices.revoke(slug, req.params.id) });
    });
    return r;
  }

  /** Where an account's sync state lives: the libraries' rooms beside the folders they replicate. */
  accountDir(slug: string): string {
    return slug === LIBRARIES_ACCOUNT
      ? this.c.librariesHome
      : join(this.c.dataRoot, slug);
  }

  /** The account a sync caller proves: a device by its token, the libraries' replica or a file service by a secret. */
  async account(cred: {
    secret?: string;
    token?: string;
  }): Promise<string | null> {
    if (cred.token) return this.c.devices.verify(cred.token)?.slug ?? null;
    if (!cred.secret) return null;
    if (cred.secret === this.c.librarySecret) return LIBRARIES_ACCOUNT;
    return (await this.c.instances.bySecret(cred.secret))?.slug ?? null;
  }

  /** The content-addressed store a binary file's bytes travel through, beside the relay — docs/blobs.md. */
  blobsRouter(): Router {
    return blobsRouter({
      accountDir: (slug) => this.accountDir(slug),
      accountOf: (cred) => this.account(cred),
    });
  }

  /** Mint a device token for the session's account and send it to the desktop's loopback `return`: how a machine pairs. */
  syncPairHandler(): RequestHandler {
    return (req, res) => {
      const back = String(req.query.return ?? "");
      // The predicate is shared with the app that builds this address: one rule, two sides.
      if (!isLoopbackReturn(back))
        return void res
          .status(400)
          .json({ error: "return must be an http loopback address" });
      const user = this.c.userOf(req);
      if (!user)
        return void res.status(401).json({ error: "no user on the session" });
      const name =
        String(req.query.name ?? "")
          .trim()
          .slice(0, 80) || "a machine";
      const { device, token } = this.c.devices.mint(
        accountKey(user),
        name,
        this.c.subjectOf(req),
      );
      const proto = req.get("x-forwarded-proto") ?? req.protocol;
      const target = new URL(back);
      target.searchParams.set("token", token);
      target.searchParams.set("device", device.id);
      target.searchParams.set(
        "url",
        `${proto === "https" ? "wss" : "ws"}://${publicHost(req)}${SYNC_PATH}`,
      );
      target.searchParams.set("identity", user);
      if (typeof req.query.state === "string")
        target.searchParams.set("state", req.query.state);
      res.redirect(target.toString());
    };
  }

  /** This account's pairings with remote servers, behind the LOCAL session: PUT pairs one, POST /main picks the main one, DELETE unpairs. */
  remoteRouter(): Router {
    const r = Router();
    r.use(express.json());
    const who = (req: Request) => {
      const user = this.c.userOf(req);
      return user ? { user, home: this.accountDir(accountKey(user)) } : null;
    };
    // Where pairing is off, nothing here may change: the origin's libraries follow the first paired account (docs/fileHub.md).
    r.use((req, res, next) => {
      if (this.c.remotePairing || req.method === "GET") return next();
      res.status(403).json({ error: "this server is not paired with another" });
    });
    r.get("/", (req, res) => {
      const w = who(req);
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      const servers = this.c.remotePairing ? readRemotes(w.home) : [];
      res.json({
        paired: servers.length > 0,
        url: servers[0]?.url ?? null,
        servers: servers.map((r) => ({ url: r.url, main: r.main })),
      });
    });
    r.put("/", (req, res) => {
      const w = who(req);
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      const token =
        typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      if (!/^wss?:\/\//.test(url) || !token)
        return void res
          .status(400)
          .json({ error: "expected { url: ws(s)://…, token }" });
      mkdirSync(w.home, { recursive: true });
      // Main unless said otherwise: a pairing made at sign-in is the main one, a server added beside it is not.
      writeRemote(w.home, {
        url,
        token,
        user: w.user,
        main: req.body?.main !== false,
      });
      void this.c.instances.restart(w.user).then(
        () => res.json({ paired: true, url }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    r.post("/main", (req, res) => {
      const w = who(req);
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      if (!setMainRemote(w.home, url))
        return void res
          .status(404)
          .json({ error: "no pairing with that server" });
      void this.c.instances.restart(w.user).then(
        () => res.json({ ok: true }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    r.delete("/", (req, res) => {
      const w = who(req);
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      // One server by `?url=`, else every one.
      const url = typeof req.query.url === "string" ? req.query.url : undefined;
      const was = forgetRemote(w.home, url);
      void this.c.instances.restart(w.user).then(
        () => res.json({ paired: false, was }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    return r;
  }

  /** The remote origin the session's account is paired with, or null: what a local surface compares itself against. */
  remoteOf(req: Request): SyncRemote | null {
    const user = this.c.userOf(req);
    if (!user || !this.c.remotePairing) return null;
    return readRemote(this.accountDir(accountKey(user)));
  }

  /** Let through a caller that proves an account by device token or hub secret; `res.locals.syncCaller` says who. */
  deviceGate(): RequestHandler {
    return (req, res, next) => {
      const cred = syncCredential(req);
      const device = cred.token ? this.c.devices.verify(cred.token) : null;
      void this.account(cred).then((slug) => {
        if (!slug)
          return void res
            .status(401)
            .json({ error: "no device token or hub secret this hub knows" });
        const caller: SyncCaller = {
          slug,
          person: device?.person ?? null,
          device: device?.name ?? null,
        };
        res.locals.syncCaller = caller;
        next();
      });
    };
  }

  /** The workspaces an account syncs, for a replica that has not seen them all — docs/syncRelay.md. */
  roomsRouter(): Router {
    return roomsRouter({
      accountDir: (slug) => this.accountDir(slug),
      accountOf: (cred) => this.account(cred),
      holdsFiles: (slug, ws) => {
        const relay = this.c.relay();
        return !relay || relay.room(slug, ws).room.files.size > 0;
      },
    });
  }

  /** The account's sync history: the rooms' logs, checkpoints, diffs and restores — behind the session. */
  historyRouter(): Router {
    return historyRouter({
      accountDir: (slug) => this.accountDir(slug),
      slugOf: (req) => {
        const user = this.c.userOf(req);
        return user ? accountKey(user) : null;
      },
      userOf: (req) => this.c.userOf(req),
      // The relay's own rooms, so a restore is ordered and relayed like any replica's batch.
      live: (slug, workspace) => this.c.relay()?.room(slug, workspace) ?? null,
    });
  }

  /** Change notices for the session's browsers, pushed as the relay orders entries — behind the session. */
  eventsRouter(): Router {
    return eventsRouter((req) => {
      const user = this.c.userOf(req);
      return user ? accountKey(user) : null;
    });
  }
}
