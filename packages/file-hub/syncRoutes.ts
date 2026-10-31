// syncRoutes.ts — the hub's live-sync routes beside the relay: devices and their pairing, a machine account's saved
// servers (one of them active; a server adds none), the rooms, blobs, history.
// Split from index.ts, which keeps the file services and the relay itself. See docs/syncRelay.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isLoopbackReturn, isServerReturn } from "@studio/web-protocol/pairing";
import express, { type Request, type RequestHandler, Router } from "express";
import { blobsRouter } from "./blobStore.ts";
import type { DeviceTokens } from "./deviceTokens.ts";
import { historyRouter } from "./historyRoutes.ts";
import { accountKey, type Instances } from "./instances.ts";
import { LIBRARIES_ACCOUNT } from "./libraryRelay.ts";
import { consentPage, sameOriginPost } from "./pairConsent.ts";
import { PairingStore } from "./pairingStore.ts";
import {
  pairReturnHandler,
  pairRouter,
  SERVER_ADDS_NONE,
} from "./pairRoutes.ts";
import { publicHost } from "./publicOrigin.ts";
import { roomsRouter, syncCredential } from "./roomsRoute.ts";
import { eventsRouter } from "./syncEvents.ts";
import type { attachSyncRelay } from "./syncRelay.ts";
import { SYNC_PATH } from "./syncRelay.ts";
import {
  engineMoves,
  forgetRemote,
  readRemote,
  readRemotes,
  type SyncRemote,
  setActiveRemote,
  writeRemote,
} from "./syncRemote.ts";

/** Who passed `deviceGate`: the account, the person who paired the device when its token says (older ones do not), the device's name. */
interface SyncCaller {
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
  /** Whether this is a machine's hub (the tray, the phones), whose accounts save servers; a server saves none. */
  remotePairing: boolean;
  /** The machine's local user, signed in nowhere; absent, nobody is. */
  isLocal?: (req: Request) => boolean;
  /** End this origin's session, for a pairing page's "Use another account"; absent, it is not offered. */
  signOut?: (req: Request) => void;
  /** This backend's port on 127.0.0.1, where a pairing's browser comes back. */
  selfPort?: () => number;
  /** A pairing stored: the machine's engine is listed at that server with its token (docs/syncRelay.md). */
  onPaired?: (origin: string, token: string) => void;
  /** A pairing let go: the machine's engine leaves that server too. */
  onForgotten?: (origin: string) => void;
}

export class SyncRoutes {
  /** The pairings under way through the browser, kept under the data root — pairingStore.ts. */
  private readonly pairings: PairingStore;

  constructor(private readonly c: SyncContext) {
    this.pairings = new PairingStore(c.dataRoot);
  }

  private pairContext() {
    return {
      store: this.pairings,
      userOf: this.c.userOf,
      isLocal: this.c.isLocal ?? (() => false),
      accountDir: (slug: string) => this.accountDir(slug),
      restart: (user: string) => this.c.instances.restart(user),
      // The browser comes back to the machine's loopback port.
      returnTo: () => `http://127.0.0.1:${this.c.selfPort?.() ?? 0}`,
      machine: this.c.remotePairing,
      selfHost: publicHost,
      engineFollows: (before: SyncRemote[], after: SyncRemote[]) =>
        this.engineFollows(before, after),
    };
  }

  /** An account's pairing with a remote server, started and awaited by its page — behind the session. */
  pairRouter(): Router {
    return pairRouter(this.pairContext());
  }

  /** The browser's way back with the other server's device token — NO session guard: the state is the gate. */
  pairReturnHandler(): RequestHandler {
    return pairReturnHandler(this.pairContext());
  }

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

  /** Mint a device token for the session's account and send it to `return`: a machine's loopback, or a server's https after a confirm. */
  syncPairHandler(): RequestHandler {
    return (req, res) => {
      // A GET carries the query; the confirm's POST carries the same fields as a form.
      const q = (k: string): string =>
        String((req.method === "POST" ? req.body?.[k] : req.query[k]) ?? "");
      const back = q("return");
      // The predicates are shared with the backend that builds this address: one rule, two sides.
      const server = isServerReturn(back);
      if (!isLoopbackReturn(back) && !server)
        return void res.status(400).json({
          error: "return must be an http loopback or a server's sync return",
        });
      const user = this.c.userOf(req);
      if (!user)
        return void res.status(401).json({ error: "no user on the session" });
      const fields = {
        return: back,
        state: q("state"),
        name: q("name"),
        ...(q("as") ? { as: q("as") } : {}),
        ...(q("choose") ? { choose: q("choose") } : {}),
      };
      const posted = req.method === "POST" && sameOriginPost(req);
      // "Use another account": signed out here, the gate signs the browser in again and it comes back to this page.
      if (posted && q("switch") === "1" && this.c.signOut) {
        this.c.signOut(req);
        const again = new URLSearchParams({ ...fields, choose: "1" });
        return void res.redirect(
          303,
          `${req.originalUrl.split("?")[0]}?${again}`,
        );
      }
      // Which account is a choice: always for another server, and for a machine adding one or expecting someone else.
      const asks =
        server || q("choose") === "1" || (!!q("as") && q("as") !== user);
      if (asks && !(posted && q("switch") !== "1")) {
        res.setHeader("Cache-Control", "no-store");
        // Framed, the Allow button could be clicked through an overlay.
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
        const name = q("name").trim().slice(0, 80) || "a machine";
        return void res
          .type("html")
          .send(
            consentPage(
              server ? { server: new URL(back).host } : { device: name },
              user,
              fields,
              !!this.c.signOut,
            ),
          );
      }
      const name = q("name").trim().slice(0, 80) || "a machine";
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
      if (q("state")) target.searchParams.set("state", q("state"));
      res.redirect(303, target.toString());
    };
  }

  /** The engine follows the active link: off the server it left, onto the one now active with its token (docs/syncRelay.md). */
  private engineFollows(before: SyncRemote[], after: SyncRemote[]): void {
    const { forget, pair } = engineMoves(before, after);
    if (forget) this.c.onForgotten?.(forget);
    if (pair) this.c.onPaired?.(pair.origin, pair.token);
  }

  /** A machine account's saved servers, behind the session: PUT saves one and makes it active, POST /active switches, DELETE forgets. */
  remoteRouter(): Router {
    const r = Router();
    r.use(express.json());
    const who = (req: Request) => {
      const user = this.c.userOf(req);
      return user ? { user, home: this.accountDir(accountKey(user)) } : null;
    };
    // A server is the remote itself: it saves no server, and lists none.
    r.use((req, res, next) => {
      if (this.c.remotePairing || req.method === "GET") return next();
      res.status(403).json({ error: SERVER_ADDS_NONE });
    });
    r.get("/", (req, res) => {
      const w = who(req);
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      const servers = this.c.remotePairing
        ? readRemotes(w.home).map((r) => ({
            id: r.id,
            url: r.url,
            origin: r.origin,
            as: r.as,
            active: r.active,
          }))
        : [];
      res.json({
        paired: servers.length > 0,
        url: servers[0]?.url ?? null,
        as: servers[0]?.as ?? null,
        servers,
      });
    });
    r.put("/", (req, res) => {
      const w = who(req);
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      const token =
        typeof req.body?.token === "string" ? req.body.token.trim() : "";
      // The remote account when the caller knows it; a token alone names none, so it is the local account's own.
      const as = typeof req.body?.as === "string" ? req.body.as.trim() : "";
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      if (!/^wss?:\/\//.test(url) || !token)
        return void res
          .status(400)
          .json({ error: "expected { url: ws(s)://…, token }" });
      mkdirSync(w.home, { recursive: true });
      const before = readRemotes(w.home);
      const link = writeRemote(w.home, {
        url,
        token,
        user: w.user,
        as: as || w.user,
      });
      this.engineFollows(before, readRemotes(w.home));
      void this.c.instances.restart(w.user).then(
        () => res.json({ paired: true, url, id: link.id }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    // The link by `id`, or the first on the server `url` names.
    const refOf = (body: unknown, query: unknown): string | undefined => {
      for (const v of [body, query]) {
        const o = v as { id?: unknown; url?: unknown } | undefined;
        if (typeof o?.id === "string" && o.id) return o.id;
        if (typeof o?.url === "string" && o.url) return o.url;
      }
      return undefined;
    };
    r.post("/active", (req, res) => {
      const w = who(req);
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      const before = readRemotes(w.home);
      if (!setActiveRemote(w.home, refOf(req.body, undefined) ?? ""))
        return void res.status(404).json({ error: "no such link" });
      // The service restarts on the new link, and the engine moves to its server.
      this.engineFollows(before, readRemotes(w.home));
      void this.c.instances.restart(w.user).then(
        () => res.json({ ok: true }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    r.delete("/", (req, res) => {
      const w = who(req);
      if (!w)
        return void res.status(401).json({ error: "no user on the session" });
      // One link by `?id=`, every link on a server by `?url=`, else every one.
      const before = readRemotes(w.home);
      const was = forgetRemote(w.home, refOf(undefined, req.query));
      this.engineFollows(before, readRemotes(w.home));
      void this.c.instances.restart(w.user).then(
        () => res.json({ paired: readRemotes(w.home).length > 0, was }),
        (e: Error) => res.status(500).json({ error: e.message }),
      );
    });
    return r;
  }

  /** The session's account's ACTIVE server, or null: the one remote every surface of a machine talks to. */
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
