// proxy.ts — the engine, relayed through the web origin. An HTTPS page may not open a
// `ws://` (nor fetch `http://`) to a LAN address, so an engine on another machine was
// unreachable from the browser however healthy it was. See docs/proxy.md for the whole of it.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import {
  HeldFrames,
  OVERLOAD_CLOSE,
  type Payload,
  sendBounded,
} from "@studio/engine-tunnel/backpressure";
import type { TunnelChannel } from "@studio/engine-tunnel/channel";
import { MAX_FRAME_BYTES } from "@studio/engine-tunnel/frames";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import {
  ENGINE_DIAL_TIMEOUT_MS,
  ENGINE_PROXY_PATH,
  ENGINE_REACH_BUDGET_MS,
} from "@studio/web-protocol";
import { WebSocket, WebSocketServer } from "ws";
import { engineRole, mayUse } from "./owners.ts";
import {
  type EngineEntry,
  type EngineRegistry,
  onThisMachine,
} from "./registry.ts";
import { type Frame, RelayGate } from "./relayGate.ts";

/** Per PROCESS and deliberately not configured: nothing to share between machines — see docs/proxy.md. */
const SECRET = randomBytes(32);
const TICKET_TTL_MS = 60_000; // a ticket only needs to survive the handshake it was minted for

// The id is in the path so a ticket cannot be replayed elsewhere.
const WS_ROUTE = new RegExp(`^${ENGINE_PROXY_PATH}/([^/]+)/ws$`);

const b64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (payload: string): string =>
  b64url(createHmac("sha256", SECRET).update(payload).digest());

/** Mint a ticket binding a relayed connection to one engine AND one account for ~a minute. */
export function issueEngineTicket(id: string, holder: string): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ id, h: holder, exp: Date.now() + TICKET_TTL_MS }),
    ),
  );
  return `${payload}.${sign(payload)}`;
}

/** The engine and the account a ticket is good for, or null when it is forged, expired or malformed. */
export function verifyEngineTicket(
  ticket: string,
): { id: string; holder: string } | null {
  const [payload, sig] = String(ticket).split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { id, h, exp } = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    );
    if (!id || typeof exp !== "number" || exp < Date.now()) return null;
    return { id: String(id), holder: typeof h === "string" ? h : "" };
  } catch {
    return null;
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Where the SERVER may dial this engine: the address its heartbeat came FROM, never one it names — see docs/proxy.md. */
export function hostsFor(
  e: Pick<EngineEntry, "publicIpHint" | "loopbackSeen">,
): string[] {
  const ip = (e.publicIpHint ?? "").replace(/^::ffff:/, "");
  if (ip === "::1" || ip.startsWith("127.") || onThisMachine(e))
    return ["127.0.0.1"];
  return IPV4.test(ip) ? [ip] : [];
}

/** What the relay pipes to: a socket it dialled, or a channel through the engine's own tunnel. */
type Upstream = WebSocket | TunnelChannel;

/** The engine's tunnel first — it reaches an engine behind any NAT — then every address in turn. */
async function dial(
  e: EngineEntry,
  tunnels?: TunnelHub,
): Promise<Upstream | null> {
  if (tunnels?.has(e.id)) {
    const ch = await tunnels.openReady(e.id, [], ENGINE_REACH_BUDGET_MS);
    if (ch) return ch;
  }
  return dialDirect(e);
}

/** Open the first address that answers, in order and sequentially, within ONE budget for the whole list — see docs/proxy.md. */
async function dialDirect(e: EngineEntry): Promise<WebSocket | null> {
  const deadline = Date.now() + ENGINE_REACH_BUDGET_MS;
  for (const host of hostsFor(e)) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const up = await new Promise<WebSocket | null>((resolve) => {
      const ws = new WebSocket(`ws://${host}:${e.addresses.port}`);
      const timer = setTimeout(
        () => {
          try {
            ws.terminate();
          } catch {
            /* already gone */
          }
          resolve(null);
        },
        Math.min(ENGINE_DIAL_TIMEOUT_MS, left),
      );
      // Over the LAN the engine answers nothing until the peer is paired, and the token is the server's proof; the reply is consumed here, never piped to the browser.
      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "pair", key: e.token }));
        ws.once("message", () => {
          clearTimeout(timer);
          resolve(ws);
        });
      });
      ws.once("error", () => {
        clearTimeout(timer);
        // Terminate too: an error AFTER the handshake leaves a socket behind, and only the timeout path above cleaned up.
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        resolve(null);
      });
    });
    if (up) return up;
  }
  return null;
}

/** Send one frame, bounded (backpressure.ts), ending both sockets if the send throws: a throw inside a socket listener escapes to the process. */
function forward(to: Upstream, from: Upstream, f: Frame): void {
  try {
    if (to.readyState === WebSocket.OPEN)
      sendBounded(to, f.data as Payload, f.binary, () => {
        overloaded(to);
        shut(from);
      });
  } catch {
    shut(to);
    shut(from);
  }
}

/** A peer that stopped reading: a browser is told why, a tunnel channel just ends. */
function overloaded(ws: Upstream): void {
  try {
    if (ws instanceof WebSocket) ws.close(OVERLOAD_CLOSE, "peer too slow");
    else ws.close();
  } catch {
    /* already closing */
  }
}

function shut(ws: Upstream): void {
  try {
    ws.close();
  } catch {
    /* already closing */
  }
}

// The engine's frames to the browser through the gate, either close ending both; the browser's go through the gate where it listens.
function pipe(client: WebSocket, upstream: Upstream, gate: RelayGate): void {
  upstream.on("message", (data: WebSocket.RawData, binary: boolean) => {
    const f = { data, binary };
    const out = gate.fromEngine(f);
    if (out) forward(client, upstream, out);
  });
  client.on("close", () => shut(upstream));
  upstream.on("close", () => shut(client));
  client.on("error", () => shut(upstream));
  upstream.on("error", () => shut(client));
}

const deny = (socket: Socket, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
};

/** Relay `/api/engine/<id>/ws` to the engine itself, attached to the HTTP SERVER because an upgrade skips Express — see docs/proxy.md. */
export function attachEngineProxy(
  server: Server,
  reg: EngineRegistry,
  tunnels?: TunnelHub,
): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });

  /** Hand an upgrade we do not serve to whoever else might, or close it — Node cleans up an unclaimed socket only when NO listener exists. */
  const notOurs = (socket: Socket): void => {
    if (server.listenerCount("upgrade") <= 1) socket.destroy();
  };

  // A throw here is an uncaught exception that ends the process, so every one is caught, said and the socket dropped.
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      onUpgrade(req, socket, head);
    } catch (e) {
      console.warn(
        `[engine-proxy] upgrade ${req.url}: ${(e as Error).message}`,
      );
      socket.destroy();
    }
  });

  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (tunnels?.handle(req, socket, head)) return;
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return notOurs(socket); // not a URL we can read
    }
    const m = WS_ROUTE.exec(url.pathname);
    if (!m) return notOurs(socket);

    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return deny(socket, "400 Bad Request"); // a malformed escape, `%E0`
    }
    const ticket = verifyEngineTicket(url.searchParams.get("ticket") || "");
    if (!ticket || ticket.id !== id) return deny(socket, "401 Unauthorized");
    const engine = reg.get(id);
    if (!engine) return deny(socket, "404 Not Found");

    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream: Upstream | null = null;
      // Buffered, and bounded, because the browser sends `whoami` before the upstream socket is dialled — see docs/proxy.md.
      const pending = new HeldFrames<WebSocket.RawData>();
      const gate = new RelayGate({
        holds: () => reg.holds(id, ticket.holder),
        // Asked per frame: a share withdrawn mid-socket stops the token at once — docs/ownership.md.
        mayReadToken: () =>
          mayUse(engineRole(reg, id, ticket.holder, !!tunnels?.isRenderer(id))),
        toEngine: (f) => {
          if (upstream) forward(upstream, client, f);
          else if (!pending.push(f.data, f.binary)) overloaded(client);
        },
        close: (code, reason) => {
          client.close(code, reason);
          if (upstream) shut(upstream);
        },
      });
      client.on("message", (data, binary) => gate.fromClient({ data, binary }));
      client.on("close", () => gate.dispose());
      // Listened to from the start: an `error` with no listener (a frame over `maxPayload`) is thrown, and ends the process.
      client.on("error", () => client.terminate());

      void dial(engine, tunnels)
        .then((up) => {
          if (!up) {
            client.close(1011, "engine unreachable from the server");
            return;
          }
          if (client.readyState !== WebSocket.OPEN) {
            up.close();
            return;
          }
          upstream = up;
          for (const f of pending.drain()) forward(up, client, f);
          pipe(client, up, gate);
        })
        .catch((e: Error) => {
          console.warn(`[engine-proxy] ${id}: ${e.message}`);
          client.terminate();
        });
    });
  };
}

/** What a body parser in FRONT of a relaying route already swallowed, ready to send again, or null when the stream is still ours — the file hub's. */
export function replayBody(req: {
  readableEnded: boolean;
  body?: unknown;
}): Buffer | null {
  if (!req.readableEnded) return null; // nobody consumed it; stream it through
  const b = req.body;
  if (b === undefined || b === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b);
  return Buffer.from(JSON.stringify(b));
}
