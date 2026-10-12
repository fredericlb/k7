// proxy.ts — the engine, relayed through the web origin. An HTTPS page may not open a
// `ws://` (nor fetch `http://`) to a LAN address, so an engine on another machine was
// unreachable from the browser however healthy it was. See docs/proxy.md for the whole of it.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { TunnelChannel } from "@studio/engine-tunnel/channel";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import {
  ENGINE_DIAL_TIMEOUT_MS,
  ENGINE_REACH_BUDGET_MS,
} from "@studio/web-protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { EngineEntry, EngineRegistry } from "./registry.ts";

/** Per PROCESS and deliberately not configured: nothing to share between machines — see docs/proxy.md. */
const SECRET = randomBytes(32);
const TICKET_TTL_MS = 60_000; // a ticket only needs to survive the handshake it was minted for

/** Where the relay listens, under each service's `/api`; the id is in the path so a ticket cannot be replayed elsewhere. */
export const ENGINE_PROXY_PATH = "/api/engine";
const WS_ROUTE = /^\/api\/engine\/([^/]+)\/ws$/;

const b64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (payload: string): string =>
  b64url(createHmac("sha256", SECRET).update(payload).digest());

/** Mint a ticket binding a relayed connection to one engine for ~a minute. */
export function issueEngineTicket(id: string): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ id, exp: Date.now() + TICKET_TTL_MS })),
  );
  return `${payload}.${sign(payload)}`;
}

/** The engine id a ticket is good for, or null when it is forged, expired or malformed. */
export function verifyEngineTicket(ticket: string): string | null {
  const [payload, sig] = String(ticket).split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { id, exp } = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    );
    if (!id || typeof exp !== "number" || exp < Date.now()) return null;
    return String(id);
  } catch {
    return null;
  }
}

/** Every address the SERVER may reach this engine on, nearest first — tried here because here it is not a secure context. */
const hostsFor = (e: EngineEntry): string[] => [
  e.addresses.loopback,
  ...e.addresses.lanIps,
];

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

// Frames each way, either close ending both; the relay reads nothing, since what travels is the browser's business.
function pipe(client: WebSocket, upstream: Upstream): void {
  const shut = (ws: Upstream) => {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  };
  client.on("message", (d, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN)
      upstream.send(d, { binary: isBinary });
  });
  upstream.on("message", (d: WebSocket.RawData, isBinary: boolean) => {
    if (client.readyState === WebSocket.OPEN)
      client.send(d, { binary: isBinary });
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
  const wss = new WebSocketServer({ noServer: true });

  /** Hand an upgrade we do not serve to whoever else might, or close it — Node cleans up an unclaimed socket only when NO listener exists. */
  const notOurs = (socket: Socket): void => {
    if (server.listenerCount("upgrade") <= 1) socket.destroy();
  };

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (tunnels?.handle(req, socket, head)) return;
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return notOurs(socket); // not a URL we can read
    }
    const m = WS_ROUTE.exec(url.pathname);
    if (!m) return notOurs(socket);

    const id = decodeURIComponent(m[1]);
    if (verifyEngineTicket(url.searchParams.get("ticket") || "") !== id)
      return deny(socket, "401 Unauthorized");
    const engine = reg.get(id);
    if (!engine) return deny(socket, "404 Not Found");

    wss.handleUpgrade(req, socket, head, (client) => {
      // Buffered, because the browser sends `whoami` before the upstream socket is dialled — see docs/proxy.md.
      const pending: { data: WebSocket.RawData; binary: boolean }[] = [];
      const hold = (data: WebSocket.RawData, binary: boolean) =>
        pending.push({ data, binary });
      client.on("message", hold);

      void dial(engine, tunnels).then((upstream) => {
        if (!upstream) {
          client.close(1011, "engine unreachable from the server");
          return;
        }
        if (client.readyState !== WebSocket.OPEN) {
          upstream.close();
          return;
        }
        client.off("message", hold);
        for (const p of pending) upstream.send(p.data, { binary: p.binary });
        pipe(client, upstream);
      });
    });
  });
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
