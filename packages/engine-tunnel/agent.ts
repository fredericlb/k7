// agent.ts — the ENGINE's end of the tunnel, run by its supervisor: one outbound socket to the
// server that lists the engine, and for every channel the server opens, a real socket to the
// local engine. Frames are rewritten by PathMap in order, one queue per direction, so a frame
// waiting on a download is never overtaken by the one after it. See docs/tunnel.md.

import { join } from "node:path";
import { WebSocket } from "ws";
import { FileRequests } from "./agentFiles.ts";
import {
  asBuffer,
  type ChannelKind,
  decodeBinary,
  encodeBinary,
  type HubMessage,
  TUNNEL_PATH,
  TUNNEL_TOKEN_HEADER,
  type TunnelRoot,
} from "./frames.ts";
import { PathMap, SyncLedger } from "./pathMap.ts";
import { answerOffer } from "./rtc.ts";

export interface TunnelAgentOptions {
  /** The registry's base URL, http(s); the tunnel is TUNNEL_PATH under it. */
  registryUrl: string;
  id: string;
  token: string;
  enginePort: number;
  /** Where this server's files are kept on this machine — one folder per server. */
  cacheDir: string;
  /** STUN/TURN servers for the WebRTC path; none keeps it to the local network. */
  iceServers?: string[];
  /** What this machine does when asked on a jobs channel, by request `type` — docs/jobs.md. */
  jobs?: Record<string, JobHandler>;
  log?: (msg: string) => void;
}

/** One request on a jobs channel; `id` is the caller's, echoed on every reply. */
export interface JobRequest {
  type: string;
  id?: string;
  [field: string]: unknown;
}

/** Answer a request, as often as it has news; paths in `emit`'s replies go back through the map. */
export type JobHandler = (
  req: JobRequest,
  emit: (reply: Record<string, unknown>) => void,
) => Promise<void> | void;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_BACKOFF_MS = 30_000;
const PING_MS = 20_000;

/** `https://h/x` → `wss://h/x/api/engine-tunnel?id=…`. */
export function tunnelUrl(registryUrl: string, id: string): string {
  const u = new URL(registryUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `${u.pathname.replace(/\/$/, "")}${TUNNEL_PATH}`;
  u.search = `?id=${encodeURIComponent(id)}`;
  return u.toString();
}

interface AgentChannel {
  /** The local engine's socket; null on a jobs channel, which this agent answers itself. */
  engine: WebSocket | null;
  map: PathMap | null;
  toEngine: Promise<void>;
  toHub: Promise<void>;
}

export class TunnelAgent {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private alive = true;
  private pinger?: NodeJS.Timeout;
  private readonly channels = new Map<number, AgentChannel>();
  private readonly ledger = new SyncLedger();
  private readonly files = new FileRequests(() => this.ws);
  private readonly log: (msg: string) => void;
  /** Whether the hub accepted us last time; the supervisor shows it. */
  connected = false;

  constructor(private readonly opts: TunnelAgentOptions) {
    this.log = opts.log ?? ((m) => console.log(`tunnel | ${m}`));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pinger) clearInterval(this.pinger);
    this.ws?.terminate();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(tunnelUrl(this.opts.registryUrl, this.opts.id), {
      headers: { [TUNNEL_TOKEN_HEADER]: this.opts.token },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      this.alive = true;
      this.connected = true;
      this.log(`up to ${this.opts.registryUrl}`);
      this.pinger = setInterval(() => {
        if (!this.alive) return void ws.terminate();
        this.alive = false;
        ws.ping();
      }, PING_MS);
    });
    ws.on("pong", () => {
      this.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) this.onBinary(asBuffer(data as Buffer));
      else this.onText(asBuffer(data as Buffer).toString("utf8"));
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      if (this.pinger) clearInterval(this.pinger);
      if (this.ws === ws) this.ws = null;
      if (this.connected) this.log(`down from ${this.opts.registryUrl}`);
      this.connected = false;
      this.files.failAll();
      for (const c of this.channels.values()) c.engine?.terminate();
      this.channels.clear();
      const step = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
      setTimeout(
        () => this.connect(),
        step / 2 + Math.random() * (step / 2),
      ).unref();
    });
  }

  private tell(m: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onText(text: string): void {
    let m: HubMessage;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.t) {
      case "open":
        this.openChannel(m.ch, m.roots, m.kind ?? "engine");
        break;
      case "close":
        this.channels.get(m.ch)?.engine?.close();
        this.channels.delete(m.ch);
        break;
      case "data":
        this.toEngine(m.ch, m.text, false);
        break;
      case "stat-reply":
        this.files.onStatReply(m.req, m.entries);
        break;
      case "put-reply":
        this.files.onPutReply(m.req, m.stat, m.error);
        break;
      case "get-error":
        this.files.onGetError(m.req, m.error);
        break;
      case "rtc-offer":
        this.answer(m.req, m.sdp);
        break;
    }
  }

  private answer(req: number, offer: string): void {
    answerOffer(offer, {
      enginePort: this.opts.enginePort,
      iceServers: this.opts.iceServers,
      log: this.log,
    }).then(
      (sdp) => this.tell({ t: "rtc-answer", req, sdp }),
      (e: Error) => this.tell({ t: "rtc-answer", req, error: e.message }),
    );
  }

  private onBinary(frame: Buffer): void {
    const d = decodeBinary(frame);
    if (!d) return;
    if (d.header.t === "chunk")
      this.files.onChunk(d.header.req, d.header.last, d.payload);
    else if (d.header.t === "data") this.toEngine(d.header.ch, d.payload, true);
  }

  private openChannel(
    ch: number,
    roots: TunnelRoot[],
    kind: ChannelKind,
  ): void {
    if (roots.some((r) => !SAFE_NAME.test(r.name))) {
      this.tell({ t: "close", ch, reason: "refused a root name" });
      return;
    }
    const map = roots.length
      ? new PathMap(
          roots.map((r) => ({
            remote: r.remote,
            local: join(this.opts.cacheDir, r.name),
            writable: r.writable,
          })),
          this.files.forChannel(ch),
          this.ledger,
          this.log,
        )
      : null;
    if (kind === "jobs") {
      const settled = Promise.resolve();
      this.channels.set(ch, {
        engine: null,
        map,
        toEngine: settled,
        toHub: settled,
      });
      this.tell({ t: "opened", ch });
      return;
    }
    const engine = new WebSocket(`ws://127.0.0.1:${this.opts.enginePort}`);
    const opened = new Promise<void>((res) => engine.once("open", () => res()));
    const c: AgentChannel = {
      engine,
      map,
      toEngine: opened,
      toHub: Promise.resolve(),
    };
    this.channels.set(ch, c);
    engine.on("open", () => this.tell({ t: "opened", ch }));
    engine.on("message", (data, isBinary) =>
      this.toHub(ch, asBuffer(data as Buffer), isBinary),
    );
    engine.on("error", (e) => this.tell({ t: "close", ch, reason: e.message }));
    engine.on("close", () => {
      if (this.channels.get(ch) !== c) return;
      this.channels.delete(ch);
      this.tell({ t: "close", ch });
    });
  }

  private toEngine(ch: number, data: string | Buffer, binary: boolean): void {
    const c = this.channels.get(ch);
    if (!c) return;
    c.toEngine = c.toEngine.then(async () => {
      const out =
        !binary && c.map ? await c.map.outbound(data as string) : data;
      if (!c.engine) {
        // A request is started once its files are here, and NOT awaited: a job takes minutes.
        if (!binary) this.runJob(ch, out as string);
        return;
      }
      if (c.engine.readyState === WebSocket.OPEN)
        c.engine.send(out, { binary });
    });
    c.toEngine = c.toEngine.catch((e) =>
      this.log(`ch${ch} → engine: ${(e as Error).message}`),
    );
  }

  /** Hand one request to its handler; every reply travels back through the channel's map. */
  private runJob(ch: number, text: string): void {
    let req: JobRequest;
    try {
      req = JSON.parse(text);
    } catch {
      return;
    }
    const emit = (reply: Record<string, unknown>): void =>
      this.toHub(
        ch,
        Buffer.from(JSON.stringify({ id: req.id, ...reply })),
        false,
      );
    const handler = this.opts.jobs?.[req.type];
    if (!handler) {
      emit({ type: "error", error: `this machine does not do '${req.type}'` });
      return;
    }
    Promise.resolve()
      .then(() => handler(req, emit))
      .catch((e: Error) => emit({ type: "error", error: e.message }));
  }

  private toHub(ch: number, data: Buffer, binary: boolean): void {
    const c = this.channels.get(ch);
    if (!c) return;
    c.toHub = c.toHub.then(async () => {
      if (binary) {
        if (this.ws?.readyState === WebSocket.OPEN)
          this.ws.send(encodeBinary({ t: "data", ch }, data));
        return;
      }
      const text = data.toString("utf8");
      this.tell({
        t: "data",
        ch,
        text: c.map ? await c.map.inbound(text) : text,
      });
    });
    c.toHub = c.toHub.catch((e) =>
      this.log(`ch${ch} → server: ${(e as Error).message}`),
    );
  }
}
