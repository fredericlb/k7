// index.ts — the file hub: `/api/files/*` on a server, answered by the calling account's own
// file-service process. A signed TICKET (or the session) says who is calling; nothing else the
// browser sends about identity is forwarded. The engine a request names is bound only on a claim.
// See docs/fileHub.md.

import { createHmac, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { join, resolve } from "node:path";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import {
  ENGINE_ID_HEADER,
  ENGINE_TOKEN_HEADER,
  FILE_HUB_HELLO,
  type FileHubHello,
  HUB_SECRET_HEADER,
  USER_HEADER,
} from "@studio/web-protocol";
import type { Request, RequestHandler, Response } from "express";
import {
  type BindingDeps,
  bindEngine,
  cutRoots,
  releaseIfUnclaimed,
  rootsFor,
  unbindAll,
} from "./binding.ts";
import { IDLE_MS } from "./capacity.ts";
import { deviceEmail, deviceUser } from "./deviceIdentity.ts";
import { DeviceTokens } from "./deviceTokens.ts";
import { Instances, type InstancesOptions, Unavailable } from "./instances.ts";
import { LibraryStore } from "./libraries.ts";
import {
  isLibrariesPath,
  jsonBody,
  librariesRoute,
} from "./librariesRoutes.ts";
import { remoteVersions } from "./libraryFetch.ts";
import { LIBRARIES_ACCOUNT, LibraryRelay } from "./libraryRelay.ts";
import { pipeTo, statusOf } from "./proxy.ts";
import { PublicLibraries } from "./publicLibraries.ts";
import {
  ShareHistoryError,
  shareCheckpoint,
  shareFilesAt,
} from "./shareHistory.ts";
import { fileServiceSourceDirs, watchSources } from "./sourceWatch.ts";
import {
  CACHE_SWEEP_EVERY_MS,
  purgeStaleHistory,
  purgeStaleRenders,
} from "./staleCaches.ts";
import { publishSyncEvent } from "./syncEvents.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";
import {
  pairedAccounts,
  readRemotes,
  type SyncRemote,
  syncTarget,
} from "./syncRemote.ts";
import { type SyncContext, SyncRoutes } from "./syncRoutes.ts";
import { mintTicket, readTicket } from "./ticket.ts";

export { holdsClaim, rootsFor } from "./binding.ts";
export type { Instance, InstancesStatus } from "./instances.ts";
export { accountKey } from "./instances.ts";
export { LibraryStore } from "./libraries.ts";
export { PUBLIC_LIBRARIES_PATH } from "./libraryFetch.ts";
export { PublicLibraries } from "./publicLibraries.ts";

/** Where a service mounts the hub; the browser composes its file base from it. */
export const FILE_HUB_PATH = "/api/files";
/** Where a service mounts `internalHandler`, which only its own file services call, over loopback. */
export const FILE_HUB_INTERNAL = `${FILE_HUB_HELLO}/internal`;
export { FILE_HUB_HELLO, type FileHubHello };

export interface FileHubOptions
  extends Omit<InstancesOptions, "onExit" | "log">,
    Omit<BindingDeps, "log"> {
  /** Who the session says is calling, or "" — the service's auth, not the hub's. */
  userOf: (req: Request) => string;
  /** The session's OIDC subject — the person a paired device's token names. */
  subjectOf?: (req: Request) => string;
  /** Whether the session's caller is in the origin's admin groups; absent, nobody is. */
  isAdmin?: (req: Request) => boolean;
  /** Signs the tickets; stable across restarts when given, or tickets die with the process. */
  ticketKey?: string;
  /** An instance nobody used for this long is stopped; default IDLE_MS. */
  idleMs?: number;
  /** A machine's hub (the tray, the phones): an account saves servers, uses the active one, and the libraries follow it. A server saves none. */
  remotePairing?: boolean;
  /** The machine's local user, signed in nowhere: a link it makes names its remote account itself. */
  isLocal?: (req: Request) => boolean;
  /** End the session on this origin, so its pairing page can be signed in to again as another account. */
  signOut?: (req: Request) => void;
  /** DEV: stop every instance when the file service's source changes — sourceWatch.ts. */
  watchSources?: boolean;
  /** A pairing stored or let go: the machine's engine follows it — docs/syncRelay.md, "The engine follows the account". */
  onRemote?: Pick<SyncContext, "onPaired" | "onForgotten">;
  log?: (msg: string) => void;
}

/** How often the libraries look for a pairing made or removed: a readdir, cheap enough. */
const PAIR_POLL_MS = 30_000;

export class FileHub {
  private readonly instances: Instances;
  private readonly deps: BindingDeps;
  private readonly reaper: NodeJS.Timeout;
  private stopSync: ReturnType<typeof attachSyncRelay> | null = null;
  /** What the relay and the blob store recognise as LIBRARIES_ACCOUNT; made per process, never written anywhere. */
  private readonly librarySecret = randomBytes(24).toString("hex");
  /** The hub's replica of each library: relayed here on the origin, following the origin on a paired machine. */
  private libraryRelay: LibraryRelay | null = null;
  private pairPoll: NodeJS.Timeout | null = null;
  // Set by stop(), so a startup still copying the libraries does not start the relay after it.
  private stopped = false;
  private readonly devices: DeviceTokens;
  private readonly renderSweep: NodeJS.Timeout;
  /** Each account's loopback path to the render machine, bound once and kept: it resolves the machine per connection. */
  private readonly renderPaths = new Map<string, string>();
  private readonly key: Buffer;
  /** The origin's libraries: the list and the one folder of each. */
  readonly libraries: LibraryStore;

  /** How full the hub is and how its starts are going: what the readiness probe reports. */
  status(): ReturnType<Instances["status"]> {
    return this.instances.status();
  }

  /** The account's service started now rather than by its first request; a failed start is that request's to report. */
  warm(user: string): void {
    void this.instances
      .get(user)
      .catch((e: Error) => this.deps.log(`warming ${user}: ${e.message}`));
  }

  /** The email of the account a device token was minted for, or null: the engine registry's owner of a heartbeat. */
  deviceEmail(token: string): string | null {
    return deviceEmail(this.devices, (s) => this.sync.accountDir(s), token);
  }

  /** Who a device token signs in as, by the door a paired machine reaches this server through; null when it names nobody. */
  deviceUser(token: string): { email: string; person: string } | null {
    return deviceUser(this.devices, (s) => this.sync.accountDir(s), token);
  }

  /** The live-sync routes beside the relay: devices, pairing, rooms, blobs, history — syncRoutes.ts. */
  readonly sync: SyncRoutes;

  constructor(private readonly opts: FileHubOptions) {
    this.key = opts.ticketKey ? Buffer.from(opts.ticketKey) : randomBytes(32);
    // Its own key, derived: a device token must not double as a file ticket, and must survive a restart as one does.
    this.devices = new DeviceTokens(
      createHmac("sha256", this.key).update("sync-devices").digest(),
      (slug) => join(resolve(opts.dataRoot), slug),
    );
    const log = opts.log ?? ((m: string) => console.log(`files | ${m}`));
    this.deps = { ...opts, log };
    // Followed while paired, and until the relay has let the follow go: a seed written into a followed folder is undone.
    this.libraries = new LibraryStore(
      resolve(opts.dataRoot),
      undefined,
      () =>
        this.pairedAccounts().length > 0 ||
        this.libraryRelay?.following === true,
    );
    // A deployment from before k7 lists `st0`: renamed before anything reads the list (docs/fileHub.md).
    if (this.libraries.renameLegacyDefault())
      log("libraries | the default library st0 is now k7-core");
    this.instances = new Instances({
      ...opts,
      log,
      onExit: (inst) => unbindAll(opts, inst),
      env: (slug) => ({
        ...opts.env?.(slug),
        STUDIO_LIBRARIES_HOME: this.libraries.home,
        STUDIO_HUB_URL: `http://127.0.0.1:${opts.selfPort()}${FILE_HUB_INTERNAL}`,
        // Live sync's relay, which every service dials unless STUDIO_LIVE_SYNC=0 (docs/syncRelay.md).
        ...syncTarget(
          `ws://127.0.0.1:${opts.selfPort()}${SYNC_PATH}`,
          this.remotesOf(slug),
          opts.remotePairing === true,
        ),
        ...this.renderTarget(slug),
      }),
      keep: (slug) => this.remotesOf(slug).length > 0,
    });
    this.sync = new SyncRoutes({
      dataRoot: resolve(opts.dataRoot),
      librariesHome: this.libraries.home,
      librarySecret: this.librarySecret,
      devices: this.devices,
      instances: this.instances,
      userOf: opts.userOf,
      subjectOf: (req) => opts.subjectOf?.(req) ?? "",
      relay: () => this.stopSync,
      remotePairing: opts.remotePairing === true,
      isLocal: opts.isLocal,
      signOut: opts.signOut,
      selfPort: opts.selfPort,
      ...opts.onRemote,
    });
    // A paired account syncs whether or not anyone opens it, so its service starts with the hub.
    for (const r of this.pairedAccounts())
      void this.instances
        .get(r.user)
        .catch((e: Error) => log(`paired ${r.user}: ${e.message}`));
    const idle = opts.idleMs ?? IDLE_MS;
    this.reaper = setInterval(
      () => void this.instances.reap(idle),
      Math.min(idle, 5 * 60_000),
    );
    this.reaper.unref();
    // The accounts' automatic renders and undo journals: what nobody used for a month goes (staleCaches.ts).
    const sweep = () => {
      const root = resolve(opts.dataRoot);
      const n = purgeStaleRenders(root) + purgeStaleHistory(root);
      if (n) log(`purged ${n} unused cache entr(ies)`);
    };
    sweep();
    this.renderSweep = setInterval(sweep, CACHE_SWEEP_EVERY_MS);
    this.renderSweep.unref();
    if (opts.watchSources) {
      const dirs = fileServiceSourceDirs();
      watchSources(dirs, (file) => {
        log(`source changed (${file}) — stopping the file services`);
        void this.instances.stopAll();
      });
      log(`watching ${dirs.length} packages of the file service`);
    }
  }

  /** The hello, mounted BEHIND the session guard: it is where a session becomes a ticket. */
  /** The published versions anyone may fetch, without a session — publicLibraries.ts. */
  publicLibrariesHandler(): RequestHandler {
    return new PublicLibraries(this.libraries).handler;
  }

  helloHandler(): RequestHandler {
    return (req, res) => {
      const user = this.opts.userOf(req);
      if (!user) {
        res.status(401).json({ error: "no user on the session" });
        return;
      }
      const admin = this.opts.isAdmin?.(req) ?? false;
      const hello: FileHubHello = {
        path: FILE_HUB_PATH,
        ticket: mintTicket(this.key, user, admin),
        admin,
      };
      res.json(hello);
    };
  }

  /** The route, mounted at FILE_HUB_PATH with NO session guard in front: the ticket is its gate. */
  handler(): RequestHandler {
    return (req, res) => {
      const presented =
        req.get(ENGINE_TOKEN_HEADER) ?? String(req.query.token ?? "");
      const ticket = presented ? readTicket(this.key, presented) : null;
      const user = ticket?.user ?? this.opts.userOf(req);
      if (!user) {
        res
          .status(401)
          .json({ error: "no valid files ticket, and no session" });
        return;
      }
      const admin = ticket ? ticket.admin : (this.opts.isAdmin?.(req) ?? false);
      if (isLibrariesPath(req.path)) {
        const changed = () =>
          this.libraryRelay?.follow(this.libraries.settings());
        void librariesRoute(this.libraries, req, res, admin, changed).catch(
          (e: Error) => {
            if (!res.headersSent)
              res.status(statusOf(e)).json({ error: e.message });
          },
        );
        return;
      }
      const engineId = req.get(ENGINE_ID_HEADER) ?? ticket?.engineId ?? null;
      void this.forward(user, admin, engineId, req, res).catch((e: Error) => {
        if (res.headersSent) return void res.end();
        if (e instanceof Unavailable)
          res.setHeader("retry-after", String(e.retryAfterS));
        res
          .status(503)
          .json({ error: `file service unavailable: ${e.message}` });
      });
    };
  }

  /** The route the INSTANCES call back, at FILE_HUB_INTERNAL: their own secret is their gate; it gives the libraries their folders. */
  internalHandler(): RequestHandler {
    return (req, res) => {
      void (async () => {
        const inst = await this.instances.bySecret(
          req.get(HUB_SECRET_HEADER) ?? "",
        );
        if (!inst) {
          res
            .status(401)
            .json({ error: "not one of this hub's file services" });
          return;
        }
        // A share's checkpoint and the files at it, for this account's own workspaces — shareHistory.ts.
        if (req.method === "POST" && req.path.startsWith("/share/")) {
          const body = (await jsonBody(req)) as {
            workspace?: unknown;
            seq?: unknown;
            name?: unknown;
            prefixes?: unknown;
          };
          const workspace = String(body.workspace ?? "");
          const seq = Number(body.seq);
          const account = this.sync.accountDir(inst.slug);
          try {
            if (req.path === "/share/checkpoint") {
              const name = String(body.name ?? "").slice(0, 120) || "share";
              const live = this.stopSync?.room(inst.slug, workspace) ?? null;
              res.json(
                shareCheckpoint(account, live, workspace, seq, name, inst.user),
              );
              return;
            }
            if (req.path === "/share/files") {
              const prefixes = Array.isArray(body.prefixes)
                ? body.prefixes.map(String)
                : [];
              res.json(shareFilesAt(account, workspace, seq, prefixes));
              return;
            }
          } catch (e) {
            const status = e instanceof ShareHistoryError ? e.status : 500;
            res.status(status).json({ error: (e as Error).message });
            return;
          }
        }
        // What the origin publishes of one library, for an unpaired machine choosing an upgrade.
        if (req.method === "POST" && req.path === "/libraries/remote") {
          const body = (await jsonBody(req)) as { name?: unknown };
          const name = typeof body.name === "string" ? body.name : "";
          res.json({ versions: await remoteVersions(name) });
          return;
        }
        if (req.method !== "POST" || req.path !== "/libraries/sync") {
          res.status(404).json({ error: `no ${req.method} ${req.path}` });
          return;
        }
        const body = (await jsonBody(req)) as {
          name?: unknown;
          draft?: unknown;
          version?: unknown;
        };
        const name = typeof body.name === "string" ? body.name : undefined;
        const notes = await this.libraries.ensure({
          name,
          draft: body.draft === true,
        });
        // A version this machine lacks, brought down from the origin's public listing.
        if (name && typeof body.version === "number")
          notes.push(await this.libraries.fetchVersion(name, body.version));
        res.json({ notes });
      })().catch((e: Error) => {
        if (!res.headersSent)
          res.status(statusOf(e)).json({ error: e.message });
      });
    };
  }

  private async forward(
    user: string,
    admin: boolean,
    engineId: string | null,
    req: Request,
    res: Response,
  ): Promise<void> {
    const { inst, release } = await this.instances.hold(user);
    // Counted in flight until the answer is done, so neither the reaper nor the cap stops it mid-request.
    if (res.closed) release();
    else res.once("close", release);
    // An engine is one account's at a time: whoever claimed it since, this account's link goes first.
    await releaseIfUnclaimed(this.deps, inst).catch((e: Error) =>
      this.deps.log(
        `[${inst.slug}] could not let go of its engine: ${e.message}`,
      ),
    );
    // A binding that fails leaves the files reachable; only the engine is not, and the log says why.
    if (engineId)
      await bindEngine(this.deps, inst, engineId).catch((e: Error) =>
        this.deps.log(
          `[${inst.slug}] could not bind engine ${engineId}: ${e.message}`,
        ),
      );
    pipeTo(inst, user, admin, req, res);
  }

  /** What a cut of this account's runs, and what it shares with the machine that runs it — pl8's stems (packages/stem-separation/docs/stemSplit.md). */
  async coldRun(
    user: string,
    chain: string,
    want: string,
  ): Promise<{ model: string; outputs: string[]; roots: TunnelRoot[] }> {
    const inst = await this.instances.get(user);
    if (!this.opts.mediatekRoot)
      throw new Error("this server holds no médiathèque to cut from");
    const r = await fetch(`http://127.0.0.1:${inst.port}/hub/cold-chain`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HUB_SECRET_HEADER]: inst.secret,
        [USER_HEADER]: user,
      },
      body: JSON.stringify({ chain, want }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      model?: string;
      outputs?: string[];
      error?: string;
    };
    if (!r.ok || !body.model)
      throw new Error(
        body.error ?? `could not resolve the chain (${r.status})`,
      );
    return {
      model: body.model,
      outputs: body.outputs ?? [],
      roots: cutRoots(inst, this.opts.mediatekRoot),
    };
  }

  /** The servers account `slug` saved, the active one first; none on a server, which syncs with its own relay alone. */
  private remotesOf(slug: string): SyncRemote[] {
    return this.opts.remotePairing
      ? readRemotes(this.sync.accountDir(slug))
      : [];
  }

  /** The accounts with an active server, which the libraries follow: none on a server. */
  private pairedAccounts(): ReturnType<typeof pairedAccounts> {
    return this.opts.remotePairing
      ? pairedAccounts(resolve(this.opts.dataRoot))
      : [];
  }

  /** Live sync's relay on the shared HTTP server; its rooms are saved on `stop`. */
  serveSync(server: Server): void {
    const relay = new LibraryRelay(
      this.libraries.home,
      `ws://127.0.0.1:${this.opts.selfPort()}${SYNC_PATH}`,
      this.librarySecret,
      this.deps.log,
    );
    this.stopSync = attachSyncRelay(server, {
      accountDir: (slug) => this.sync.accountDir(slug),
      accountOf: (secret) => this.sync.account({ secret }),
      deviceOf: (token) => this.devices.verify(token)?.slug ?? null,
      // The libraries are every account's to follow, read-only, as `@lib/<name>`.
      sharedAccount: LIBRARIES_ACCOUNT,
      onOrdered: publishSyncEvent,
      log: this.deps.log,
    });
    // A pairing comes and goes through syncRoutes.ts, which restarts the account's service alone: the libraries look for themselves.
    const source = () => {
      const r = this.pairedAccounts()[0];
      if (r) relay.followRemote(r.url, r.token);
      else relay.followLocal();
    };
    this.libraryRelay = relay;
    // The folders first, copied off the event loop, then the relay that follows them; a standalone started this ensure before it listened.
    void this.libraries
      .firstEnsure()
      .catch((e: Error) => this.deps.log(`libraries | ${e.message}`))
      .then(() => {
        if (this.stopped) return;
        source();
        relay.follow(this.libraries.settings());
        this.pairPoll = setInterval(source, PAIR_POLL_MS);
        this.pairPoll.unref();
      });
  }

  /** Where an account's service renders when it has no engine binary and no bound machine: the deployment's render machine, if any. */
  private renderTarget(slug: string): Record<string, string> {
    if (!this.opts.tunnels.rendersEnabled()) return {};
    let path = this.renderPaths.get(slug);
    if (!path) {
      const home = join(resolve(this.opts.dataRoot), slug);
      path = this.opts.tunnels.bindRenderer(
        rootsFor({ home, slug }, this.opts.mediatekRoot),
      );
      this.renderPaths.set(slug, path);
    }
    return {
      STUDIO_RENDER_JOBS_URL: `ws://127.0.0.1:${this.opts.selfPort()}${path}`,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.reaper);
    clearInterval(this.renderSweep);
    if (this.pairPoll) clearInterval(this.pairPoll);
    this.libraryRelay?.stop();
    this.stopSync?.();
    await this.instances.stopAll();
  }
}
