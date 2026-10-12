// index.ts — the file hub: `/api/files/*` on a server, answered by the calling account's own
// file-service process. A signed TICKET (or the session) says who is calling; nothing else the
// browser sends about identity is forwarded. The engine a request names is bound only on a claim.
// See docs/fileHub.md.

import { createHmac, randomBytes } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { join, resolve } from "node:path";
import { replayBody } from "@studio/engine-registry";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import {
  ADMIN_HEADER,
  ENGINE_ID_HEADER,
  ENGINE_TOKEN_HEADER,
  FILE_HUB_HELLO,
  type FileHubHello,
  HUB_SECRET_HEADER,
  USER_HEADER,
} from "@studio/web-protocol";
import express, {
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from "express";
import {
  type BindingDeps,
  bindEngine,
  cutRoots,
  releaseIfUnclaimed,
  unbindAll,
} from "./binding.ts";
import { DeviceTokens } from "./deviceTokens.ts";
import {
  type Instance,
  Instances,
  type InstancesOptions,
} from "./instances.ts";
import { accountKey } from "./instances.ts";
import { LibraryStore } from "./libraries.ts";
import { LIBRARIES_ACCOUNT, LibraryRelay } from "./libraryRelay.ts";
import {
  isLibrariesPath,
  jsonBody,
  librariesRoute,
} from "./librariesRoutes.ts";
import { fileServiceSourceDirs, watchSources } from "./sourceWatch.ts";
import {
  CACHE_SWEEP_EVERY_MS,
  purgeStaleHistory,
  purgeStaleRenders,
} from "./staleCaches.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";
import { mintTicket, readTicket } from "./ticket.ts";

export { holdsClaim, rootsFor } from "./binding.ts";
export type { Instance } from "./instances.ts";
export { accountKey } from "./instances.ts";

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
  /** Whether the session's caller is in the origin's admin groups; absent, nobody is. */
  isAdmin?: (req: Request) => boolean;
  /** Signs the tickets; stable across restarts when given, or tickets die with the process. */
  ticketKey?: string;
  /** An instance nobody used for this long is stopped. */
  idleMs?: number;
  /** DEV: stop every instance when the file service's source changes — sourceWatch.ts. */
  watchSources?: boolean;
  log?: (msg: string) => void;
}

/** Headers a client may not choose: identity and the hub's own secret are the hub's to set. */
const DROPPED = new Set([
  "cookie",
  "authorization",
  "host",
  USER_HEADER,
  HUB_SECRET_HEADER,
  ENGINE_TOKEN_HEADER,
  ADMIN_HEADER,
]);

export class FileHub {
  private readonly instances: Instances;
  private readonly deps: BindingDeps;
  private readonly reaper: NodeJS.Timeout;
  private stopSync: (() => void) | null = null;
  /** The server's replica of each library, on the origin only: a machine's hub keeps its bundled copy. */
  private libraryRelay: LibraryRelay | null = null;
  private readonly devices: DeviceTokens;
  private readonly renderSweep: NodeJS.Timeout;
  private readonly key: Buffer;
  /** The origin's libraries: the list and the one folder of each. */
  readonly libraries: LibraryStore;

  constructor(private readonly opts: FileHubOptions) {
    this.key = opts.ticketKey ? Buffer.from(opts.ticketKey) : randomBytes(32);
    // Its own key, derived: a device token must not double as a file ticket, and must survive a restart as one does.
    this.devices = new DeviceTokens(
      createHmac("sha256", this.key).update("sync-devices").digest(),
      (slug) => join(resolve(opts.dataRoot), slug),
    );
    const log = opts.log ?? ((m: string) => console.log(`files | ${m}`));
    this.deps = { ...opts, log };
    this.libraries = new LibraryStore(resolve(opts.dataRoot));
    this.instances = new Instances({
      ...opts,
      log,
      onExit: (inst) => unbindAll(opts, inst),
      env: () => ({
        ...opts.env?.(),
        STUDIO_LIBRARIES_HOME: this.libraries.home,
        STUDIO_HUB_URL: `http://127.0.0.1:${opts.selfPort()}${FILE_HUB_INTERNAL}`,
        // Live sync's relay, which every service dials unless STUDIO_LIVE_SYNC=0 (docs/syncRelay.md).
        ...syncTarget(opts.selfPort()),
      }),
    });
    const idle = opts.idleMs ?? 30 * 60_000;
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
            if (!res.headersSent) res.status(500).json({ error: e.message });
          },
        );
        return;
      }
      const engineId = req.get(ENGINE_ID_HEADER) ?? ticket?.engineId ?? null;
      void this.forward(user, admin, engineId, req, res).catch((e: Error) => {
        if (res.headersSent) res.end();
        else
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
        if (req.method !== "POST" || req.path !== "/libraries/sync") {
          res.status(404).json({ error: `no ${req.method} ${req.path}` });
          return;
        }
        const body = (await jsonBody(req)) as { name?: unknown };
        const notes = this.libraries.ensure({
          name: typeof body.name === "string" ? body.name : undefined,
        });
        res.json({ notes });
      })().catch((e: Error) => {
        if (!res.headersSent) res.status(500).json({ error: e.message });
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
    const inst = await this.instances.get(user);
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

  /** The account's sync devices: list, add (answering the token once), remove — mounted behind the session guard. */
  devicesRouter(): Router {
    const r = Router();
    r.use(express.json());
    const slugOf = (req: Request): string | null => {
      const user = this.opts.userOf(req);
      return user ? accountKey(user) : null;
    };
    r.get("/", (req, res) => {
      const slug = slugOf(req);
      if (!slug) res.status(401).json({ error: "no user on the session" });
      else res.json({ devices: this.devices.list(slug) });
    });
    r.post("/", (req, res) => {
      const slug = slugOf(req);
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!slug)
        return void res.status(401).json({ error: "no user on the session" });
      if (!name)
        return void res.status(400).json({ error: "a device needs a name" });
      const { device, token } = this.devices.mint(slug, name);
      const proto = req.get("x-forwarded-proto") ?? req.protocol;
      const url = `${proto === "https" ? "wss" : "ws"}://${req.get("host")}${SYNC_PATH}`;
      res.json({ device, token, url });
    });
    r.delete("/:id", (req, res) => {
      const slug = slugOf(req);
      if (!slug)
        return void res.status(401).json({ error: "no user on the session" });
      res.json({ removed: this.devices.revoke(slug, req.params.id) });
    });
    return r;
  }

  /** Live sync's relay on the shared HTTP server; its rooms are saved on `stop`. */
  serveSync(server: Server): void {
    const dataRoot = resolve(this.opts.dataRoot);
    const relay = new LibraryRelay(
      this.libraries.home,
      `ws://127.0.0.1:${this.opts.selfPort()}${SYNC_PATH}`,
      this.deps.log,
    );
    this.stopSync = attachSyncRelay(server, {
      // The libraries' rooms live beside the folders they replicate.
      accountDir: (slug) =>
        slug === LIBRARIES_ACCOUNT ? this.libraries.home : join(dataRoot, slug),
      accountOf: async (secret) =>
        secret === relay.secret
          ? LIBRARIES_ACCOUNT
          : ((await this.instances.bySecret(secret))?.slug ?? null),
      deviceOf: (token) => this.devices.verify(token)?.slug ?? null,
      log: this.deps.log,
    });
    if (!syncTarget(0).STUDIO_SYNC_TOKEN) {
      this.libraries.ensure();
      relay.follow(this.libraries.settings());
      this.libraryRelay = relay;
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.reaper);
    clearInterval(this.renderSweep);
    this.libraryRelay?.stop();
    this.stopSync?.();
    await this.instances.stopAll();
  }
}

/** Where this hub's services sync: a REMOTE relay with a device token when this hub is a machine's, else its own. */
function syncTarget(port: number): Record<string, string> {
  const url = process.env.STUDIO_SYNC_REMOTE_URL?.trim();
  const token = process.env.STUDIO_SYNC_REMOTE_TOKEN?.trim();
  if (url && token) return { STUDIO_SYNC_URL: url, STUDIO_SYNC_TOKEN: token };
  return { STUDIO_SYNC_URL: `ws://127.0.0.1:${port}${SYNC_PATH}` };
}

/** One request to the instance, the session's user, its admin flag and the hub's secret stamped on it. */
function pipeTo(
  inst: Instance,
  user: string,
  admin: boolean,
  req: Request,
  res: Response,
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers))
    if (v !== undefined && !DROPPED.has(k.toLowerCase())) headers[k] = v;
  headers.host = `127.0.0.1:${inst.port}`;
  headers[USER_HEADER] = user;
  if (admin) headers[ADMIN_HEADER] = "1";
  headers[HUB_SECRET_HEADER] = inst.secret;
  const body = replayBody(req);
  if (body) {
    headers["content-length"] = String(body.length);
    delete headers["transfer-encoding"];
  }
  const up = httpRequest(
    {
      host: "127.0.0.1",
      port: inst.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.status(upRes.statusCode ?? 502);
      for (const [k, v] of Object.entries(upRes.headers))
        if (v !== undefined && k.toLowerCase() !== "transfer-encoding")
          res.setHeader(k, v as string | string[]);
      upRes.pipe(res);
    },
  );
  up.on("error", (e) => {
    // Past the headers a clean end would pass a cut-off body as a whole one: the browser must see the connection fail.
    if (res.headersSent) res.destroy();
    else res.status(502).json({ error: `file service: ${e.message}` });
  });
  if (body) up.end(body);
  else req.pipe(up);
}
