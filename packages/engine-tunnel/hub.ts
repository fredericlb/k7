// hub.ts — the SERVER end of the engine tunnels: supervisors dial in on TUNNEL_PATH, and
// anything on the server that needs an engine opens a channel through the one that owns it.
// A process on this host that only speaks `ws://` gets a LOOPBACK address bound to an engine
// (bindLocal), so the file service's own client needs no idea the engine is far away.
// See docs/tunnel.md.

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { OPEN, type TunnelChannel } from "./channel.ts";
import {
  type ChannelKind,
  TUNNEL_PATH,
  TUNNEL_RENDER_KEY_HEADER,
  TUNNEL_TOKEN_HEADER,
  type TunnelRoot,
} from "./frames.ts";
import { HubTunnel } from "./hubTunnel.ts";

export interface TunnelHubOptions {
  /** Whether `id` is an engine this server lists, and `token` its secret. */
  verify(id: string, token: string): boolean;
  /** The key a tunnel presents to be the server's render machine; unset, no tunnel is one — docs/jobs.md. */
  renderKey?: string;
  /** Keepalive period; a tunnel silent for two of these is dropped. */
  pingMs?: number;
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

const isLoopback = (addr: string | undefined): boolean =>
  !!addr &&
  (addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127."));

const sameKey = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const deny = (socket: Socket, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
};

export class TunnelHub {
  private readonly tunnels = new Map<string, HubTunnel>();
  private readonly locals = new Map<string, LocalBinding>();
  /** The engines whose tunnel presented the render key, most recent last. */
  private readonly renderers = new Set<string>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly log: (msg: string) => void;
  private pinger?: NodeJS.Timeout;

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
    if (url.pathname === TUNNEL_PATH) {
      this.acceptTunnel(req, socket, head, url);
      return true;
    }
    const local = LOCAL_ROUTE.exec(url.pathname);
    if (!local) return false;
    this.acceptLocal(req, socket, head, local[1]);
    return true;
  }

  /** For a server with no other upgrade route; a service holding a relay routes through `handle` instead. */
  attach(server: Server): void {
    server.on(
      "upgrade",
      (req: IncomingMessage, socket: Socket, head: Buffer) => {
        if (
          !this.handle(req, socket, head) &&
          server.listenerCount("upgrade") <= 1
        )
          socket.destroy();
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
    if (!id || !token || !this.opts.verify(id, token)) {
      deny(socket, "403 Forbidden");
      return;
    }
    // A wrong key is refused rather than ignored: a render machine that is not one must say so in its log.
    const offered = String(req.headers[TUNNEL_RENDER_KEY_HEADER] ?? "");
    const renders = !!offered && !!this.opts.renderKey;
    if (offered && (!renders || !sameKey(offered, this.opts.renderKey ?? ""))) {
      deny(socket, "403 Forbidden");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // One tunnel per engine: a reconnect replaces the socket it outlived.
      this.tunnels.get(id)?.ws.terminate();
      const t = new HubTunnel(id, ws, this.log);
      this.tunnels.set(id, t);
      // Re-added, so the newest render machine is the one a render reaches.
      this.renderers.delete(id);
      if (renders) this.renderers.add(id);
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
    const binding = isLoopback(req.socket.remoteAddress)
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

/** A local client and a channel, frames both ways; what the client sends before the engine answers is held. */
function pipe(client: WebSocket, channel: TunnelChannel): void {
  const held: { data: RawData; binary: boolean }[] = [];
  client.on("message", (data, binary) => {
    if (channel.readyState === OPEN)
      channel.send(binary ? (data as Buffer) : data.toString(), { binary });
    else held.push({ data, binary });
  });
  channel.once("open", () => {
    for (const h of held.splice(0))
      channel.send(h.binary ? (h.data as Buffer) : h.data.toString(), {
        binary: h.binary,
      });
  });
  channel.on("message", (data: Buffer, binary: boolean) => {
    if (client.readyState === WebSocket.OPEN)
      client.send(binary ? data : data.toString("utf8"), { binary });
  });
  channel.on("close", () => client.close());
  client.on("close", () => channel.close());
  client.on("error", () => channel.close());
}
