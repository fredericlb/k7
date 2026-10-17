// hub.ts — the SERVER end of the engine tunnels: supervisors dial in on TUNNEL_PATH, and
// anything on the server that needs an engine opens a channel through the one that owns it.
// A process on this host that only speaks `ws://` gets a LOOPBACK address bound to an engine
// (bindLocal), so the file service's own client needs no idea the engine is far away.
// See docs/tunnel.md.

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import {
  engineProtocolOf,
  MIN_ENGINE_PROTOCOL,
} from "@studio/engine-protocol/version";
import { isLoopbackAddress } from "@studio/web-protocol/services";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import {
  HeldFrames,
  OVERLOAD_CLOSE,
  type Payload,
  sendBounded,
} from "./backpressure.ts";
import { OPEN, type TunnelChannel } from "./channel.ts";
import {
  type ChannelKind,
  MAX_FRAME_BYTES,
  TUNNEL_PATH,
  TUNNEL_PROTOCOL_HEADER,
  TUNNEL_RENDER_KEY_HEADER,
  TUNNEL_SECRET_HEADER,
  TUNNEL_TOKEN_HEADER,
  type TunnelRoot,
} from "./frames.ts";
import type { UploadLimits } from "./hubFiles.ts";
import { HubTunnel } from "./hubTunnel.ts";

export interface TunnelHubOptions {
  /** Whether `id` is an engine this server lists, `token` its token and `secret` the tunnel secret it is bound to. */
  verify(id: string, token: string, secret?: string): boolean;
  /** The key a tunnel presents to be the server's render machine; unset, no tunnel is one — docs/jobs.md. */
  renderKey?: string;
  /** Keepalive period; a tunnel silent for two of these is dropped. */
  pingMs?: number;
  /** What one tunnel may upload; the defaults are `uploadLimits` in hubFiles.ts. */
  uploads?: Partial<UploadLimits>;
  /** The oldest engine wire served; MIN_ENGINE_PROTOCOL unless a test raises it — engine-protocol's docs/version.md. */
  minProtocol?: number;
  log?: (msg: string) => void;
}

interface LocalBinding {
  /** Null is the render machine, whichever tunnel holds the render key when a client connects. */
  engineId: string | null;
  roots: TunnelRoot[];
  kind: ChannelKind;
  synced: boolean;
}

const LOCAL_ROUTE = new RegExp(`^${TUNNEL_PATH}/local/([A-Za-z0-9_-]+)$`);

const sameKey = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const deny = (socket: Socket, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
};

/** A refusal with a reason in its body, which a supervisor's log shows beside the status. */
const denyWith = (socket: Socket, status: string, reason: string): void => {
  const body = Buffer.from(reason, "utf8");
  socket.write(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
  );
  socket.write(body);
  socket.destroy();
};

export class TunnelHub {
  private readonly tunnels = new Map<string, HubTunnel>();
  private readonly locals = new Map<string, LocalBinding>();
  /** The engines whose tunnel presented the render key, most recent last. */
  private readonly renderers = new Set<string>();
  /** The same engines, kept while their tunnel is down: the server role must outlive a drop. */
  private readonly rendered = new Set<string>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });
  private readonly log: (msg: string) => void;
  private pinger?: NodeJS.Timeout;
  /** Engines already said to be refused for their protocol: a supervisor redials every half-minute. */
  private readonly outdated = new Set<string>();

  constructor(private readonly opts: TunnelHubOptions) {
    this.log = opts.log ?? ((m) => console.log(`tunnel | ${m}`));
  }

  /** Whether the engine `id` has a tunnel up right now. */
  has(id: string): boolean {
    return this.tunnels.has(id);
  }

  /** A channel to engine `id`, or null when it has no tunnel; it emits `open` when the engine answered. */
  open(
    id: string,
    roots: TunnelRoot[] = [],
    kind: ChannelKind = "engine",
    synced = false,
  ): TunnelChannel | null {
    return this.tunnels.get(id)?.open(roots, kind, synced) ?? null;
  }

  /** …the same, resolved once the engine answered, or null after `timeoutMs`. */
  openReady(
    id: string,
    roots: TunnelRoot[] = [],
    timeoutMs = 5000,
    kind: ChannelKind = "engine",
  ): Promise<TunnelChannel | null> {
    const ch = this.open(id, roots, kind);
    if (!ch) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        ch.close();
        resolve(null);
      }, timeoutMs);
      ch.once("open", () => {
        clearTimeout(timer);
        resolve(ch);
      });
      ch.once("close", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  /** The engine's answer to a browser's WebRTC offer; throws when it has no tunnel or declines. */
  signal(id: string, sdp: string, timeoutMs = 10_000): Promise<string> {
    const t = this.tunnels.get(id);
    if (!t) return Promise.reject(new Error("this engine has no tunnel"));
    return t.signal(sdp, timeoutMs);
  }

  /** A loopback path that reaches engine `id` with `roots` shared; the key in it is the only credential. */
  bindLocal(
    engineId: string,
    roots: TunnelRoot[],
    kind: ChannelKind = "engine",
    { synced = false }: { synced?: boolean } = {},
  ): string {
    const key = randomBytes(24).toString("base64url");
    this.locals.set(key, { engineId, roots, kind, synced });
    return `${TUNNEL_PATH}/local/${key}`;
  }

  /** Whether this hub has a render machine configured at all. */
  rendersEnabled(): boolean {
    return !!this.opts.renderKey;
  }

  /** The render machine's id when its tunnel is up, the most recent one if several hold the key. */
  renderer(): string | null {
    let last: string | null = null;
    for (const id of this.renderers) if (this.tunnels.has(id)) last = id;
    return last;
  }

  /** Whether engine `id`'s last tunnel presented the render key, up or not: the server's own engine — docs/jobs.md. */
  isRenderer(id: string): boolean {
    return this.rendered.has(id);
  }

  /** A loopback jobs path to the render machine, resolved when a client connects, so it outlives the machine's restarts. */
  bindRenderer(roots: TunnelRoot[]): string {
    const key = randomBytes(24).toString("base64url");
    this.locals.set(key, {
      engineId: null,
      roots,
      kind: "jobs",
      synced: false,
    });
    return `${TUNNEL_PATH}/local/${key}`;
  }

  unbindLocal(path: string): void {
    const m = LOCAL_ROUTE.exec(path);
    if (m) this.locals.delete(m[1]);
  }

  /** Claim an upgrade if it is ours — supervisors on TUNNEL_PATH, loopback clients on their bound paths. */
  handle(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return false;
    }
    this.pinger ??= setInterval(() => this.ping(), this.opts.pingMs ?? 20_000);
    this.pinger.unref();
    const local = LOCAL_ROUTE.exec(url.pathname);
    if (url.pathname !== TUNNEL_PATH && !local) return false;
    // Claimed either way: a throw while accepting is said and drops this socket, never the process.
    try {
      if (local) this.acceptLocal(req, socket, head, local[1]);
      else this.acceptTunnel(req, socket, head, url);
    } catch (e) {
      this.log(`upgrade ${url.pathname}: ${(e as Error).message}`);
      socket.destroy();
    }
    return true;
  }

  /** For a server with no other upgrade route; a service holding a relay routes through `handle` instead. */
  attach(server: Server): void {
    server.on(
      "upgrade",
      (req: IncomingMessage, socket: Socket, head: Buffer) => {
        try {
          if (
            !this.handle(req, socket, head) &&
            server.listenerCount("upgrade") <= 1
          )
            socket.destroy();
        } catch (e) {
          this.log(`upgrade ${req.url}: ${(e as Error).message}`);
          socket.destroy();
        }
      },
    );
  }

  stop(): void {
    if (this.pinger) clearInterval(this.pinger);
    for (const t of this.tunnels.values()) t.ws.terminate();
  }

  private acceptTunnel(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
    url: URL,
  ): void {
    const id = url.searchParams.get("id") ?? "";
    const token = String(req.headers[TUNNEL_TOKEN_HEADER] ?? "");
    const secret = String(req.headers[TUNNEL_SECRET_HEADER] ?? "") || undefined;
    // Checked BEFORE the incumbent is touched: a refused newcomer leaves the live tunnel where it is.
    if (!id || !token || !this.opts.verify(id, token, secret)) {
      deny(socket, "403 Forbidden");
      return;
    }
    // Below the minimum, the machine is told to update rather than served a wire it would misread.
    const protocol = engineProtocolOf(req.headers[TUNNEL_PROTOCOL_HEADER]);
    const min = this.opts.minProtocol ?? MIN_ENGINE_PROTOCOL;
    if (protocol < min) {
      const reason = `this engine speaks protocol ${protocol} and this server needs ${min} at least — update k7 on this machine`;
      if (!this.outdated.has(id)) this.log(`${id} refused: ${reason}`);
      this.outdated.add(id);
      denyWith(socket, "426 Upgrade Required", reason);
      return;
    }
    this.outdated.delete(id);
    // A wrong key is refused rather than ignored: a render machine that is not one must say so in its log.
    const offered = String(req.headers[TUNNEL_RENDER_KEY_HEADER] ?? "");
    const renders = !!offered && !!this.opts.renderKey;
    if (offered && (!renders || !sameKey(offered, this.opts.renderKey ?? ""))) {
      deny(socket, "403 Forbidden");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // One tunnel per engine: a reconnect, verified above, replaces the socket it outlived.
      this.tunnels.get(id)?.ws.terminate();
      const t = new HubTunnel(id, ws, this.log, this.opts.uploads);
      this.tunnels.set(id, t);
      // Re-added, so the newest render machine is the one a render reaches.
      this.renderers.delete(id);
      if (renders) this.renderers.add(id);
      if (renders) this.rendered.add(id);
      else this.rendered.delete(id);
      this.log(`${id} up${renders ? " (render machine)" : ""}`);
      ws.on("close", () => {
        t.shutdown();
        if (this.tunnels.get(id) === t) {
          this.tunnels.delete(id);
          this.renderers.delete(id);
          this.log(`${id} down`);
        }
      });
      // Said before cutting: a frame the socket refused is otherwise only an "Internal error" on the machine.
      ws.on("error", (e) => {
        this.log(`${id} socket error: ${e.message}`);
        ws.terminate();
      });
    });
  }

  private acceptLocal(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
    key: string,
  ): void {
    const binding = isLoopbackAddress(req.socket.remoteAddress)
      ? this.locals.get(key)
      : undefined;
    const engineId = binding ? (binding.engineId ?? this.renderer()) : null;
    const channel =
      binding && engineId
        ? this.open(engineId, binding.roots, binding.kind, binding.synced)
        : null;
    if (!channel) {
      deny(socket, binding ? "503 Service Unavailable" : "403 Forbidden");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (client) =>
      pipe(client, channel),
    );
  }

  private ping(): void {
    for (const t of this.tunnels.values()) {
      if (!t.alive) {
        t.ws.terminate();
        continue;
      }
      t.alive = false;
      t.ws.ping();
    }
  }
}

/** A local client and a channel, frames both ways and bounded; what the client sends before the engine answers is held. */
function pipe(client: WebSocket, channel: TunnelChannel): void {
  const held = new HeldFrames();
  // A peer that stopped reading is closed rather than queued for without end — backpressure.ts.
  const overrun = (): void => {
    channel.close();
    client.close(OVERLOAD_CLOSE, "peer too slow");
  };
  // Guarded: a throw inside a socket listener escapes to the process, so it ends this pair instead.
  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch {
      channel.close();
      client.terminate();
    }
  };
  const toChannel = (data: Payload, binary: boolean): void => {
    sendBounded(channel, data, binary, overrun);
  };
  client.on("message", (data: RawData, binary) =>
    safely(() => {
      const payload = binary ? (data as Buffer) : data.toString();
      if (channel.readyState === OPEN) toChannel(payload, binary);
      else if (!held.push(payload, binary)) overrun();
    }),
  );
  channel.once("open", () =>
    safely(() => {
      for (const h of held.drain()) toChannel(h.data, h.binary);
    }),
  );
  channel.on("message", (data: Buffer, binary: boolean) =>
    safely(() => {
      if (client.readyState === WebSocket.OPEN)
        sendBounded(
          client,
          binary ? data : data.toString("utf8"),
          binary,
          overrun,
        );
    }),
  );
  channel.on("close", () => client.close());
  client.on("close", () => channel.close());
  client.on("error", () => channel.close());
}
