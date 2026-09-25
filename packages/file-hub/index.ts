// index.ts — the file hub: `/api/files/*` on a server, answered by the calling account's own
// file-service process. A signed TICKET (or the session) says who is calling; nothing else the
// browser sends about identity is forwarded. The engine a request names is bound only on a claim.
// See docs/fileHub.md.

import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { replayBody } from "@studio/engine-registry";
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
  unbindAll,
} from "./binding.ts";
import {
  type Instance,
  Instances,
  type InstancesOptions,
} from "./instances.ts";
import { mintTicket, readTicket } from "./ticket.ts";

export { holdsClaim, rootsFor } from "./binding.ts";
export type { Instance } from "./instances.ts";
export { accountKey } from "./instances.ts";

/** Where a service mounts the hub; the browser composes its file base from it. */
export const FILE_HUB_PATH = "/api/files";
export { FILE_HUB_HELLO, type FileHubHello };

export interface FileHubOptions
  extends Omit<InstancesOptions, "onExit" | "log">,
    Omit<BindingDeps, "log"> {
  /** Who the session says is calling, or "" — the service's auth, not the hub's. */
  userOf: (req: Request) => string;
  /** Signs the tickets; stable across restarts when given, or tickets die with the process. */
  ticketKey?: string;
  /** An instance nobody used for this long is stopped. */
  idleMs?: number;
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
]);

export class FileHub {
  private readonly instances: Instances;
  private readonly deps: BindingDeps;
  private readonly reaper: NodeJS.Timeout;
  private readonly key: Buffer;

  constructor(private readonly opts: FileHubOptions) {
    this.key = opts.ticketKey ? Buffer.from(opts.ticketKey) : randomBytes(32);
    const log = opts.log ?? ((m: string) => console.log(`files | ${m}`));
    this.deps = { ...opts, log };
    this.instances = new Instances({
      ...opts,
      log,
      onExit: (inst) => unbindAll(opts, inst),
    });
    const idle = opts.idleMs ?? 30 * 60_000;
    this.reaper = setInterval(
      () => void this.instances.reap(idle),
      Math.min(idle, 5 * 60_000),
    );
    this.reaper.unref();
  }

  /** The hello, mounted BEHIND the session guard: it is where a session becomes a ticket. */
  helloHandler(): RequestHandler {
    return (req, res) => {
      const user = this.opts.userOf(req);
      if (!user) {
        res.status(401).json({ error: "no user on the session" });
        return;
      }
      const hello: FileHubHello = {
        path: FILE_HUB_PATH,
        ticket: mintTicket(this.key, user),
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
      const engineId = req.get(ENGINE_ID_HEADER) ?? ticket?.engineId ?? null;
      void this.forward(user, engineId, req, res).catch((e: Error) => {
        if (res.headersSent) res.end();
        else
          res
            .status(503)
            .json({ error: `file service unavailable: ${e.message}` });
      });
    };
  }

  private async forward(
    user: string,
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
    pipeTo(inst, user, req, res);
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

  async stop(): Promise<void> {
    clearInterval(this.reaper);
    await this.instances.stopAll();
  }
}

/** One request to the instance, the session's user and the hub's secret stamped on it. */
function pipeTo(
  inst: Instance,
  user: string,
  req: Request,
  res: Response,
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers))
    if (v !== undefined && !DROPPED.has(k.toLowerCase())) headers[k] = v;
  headers.host = `127.0.0.1:${inst.port}`;
  headers[USER_HEADER] = user;
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
    if (res.headersSent) res.end();
    else res.status(502).json({ error: `file service: ${e.message}` });
  });
  if (body) up.end(body);
  else req.pipe(up);
}
