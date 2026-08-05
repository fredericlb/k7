// proxy.ts — the engine, relayed through the web origin. An HTTPS page may not open a
// `ws://` (nor fetch `http://`) to a LAN address, so an engine on another machine was
// unreachable from the browser however healthy it was. See docs/proxy.md for the whole of it.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import type { RequestHandler } from "express";
import { WebSocket, WebSocketServer } from "ws";
import type { EngineEntry, EngineRegistry } from "./registry.ts";

/**
 * Per PROCESS, and deliberately not configured.
 *
 * A ticket lives a minute and is minted by the same process that verifies it, so there is
 * nothing to share between machines and no secret to plumb through three backends. A restart
 * invalidates the outstanding ones, which costs a browser one refetch of a list it polls
 * anyway.
 */
const SECRET = randomBytes(32);
const TICKET_TTL_MS = 60_000; // a ticket only needs to survive the handshake it was minted for

/** Where the relay listens, under each service's `/api`. The id is in the path so a ticket
 *  cannot be replayed against a different engine. */
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

/** Every address the SERVER may reach this engine on, nearest first — the same list the
 *  browser used to try itself, tried here instead because here it is not a secure context. */
const hostsFor = (e: EngineEntry): string[] => [
  e.addresses.loopback,
  ...e.addresses.lanIps,
];

const DIAL_TIMEOUT_MS = 1500;

// Open the first address that answers, in order. Sequential rather than raced: the list is two
// or three long, loopback wins it whenever the backend shares the engine's machine, and a race
// would leave losing sockets half-open against an audio process.
async function dial(e: EngineEntry): Promise<WebSocket | null> {
  for (const host of hostsFor(e)) {
    const up = await new Promise<WebSocket | null>((resolve) => {
      const ws = new WebSocket(`ws://${host}:${e.addresses.port}`);
      const timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        resolve(null);
      }, DIAL_TIMEOUT_MS);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    if (up) return up;
  }
  return null;
}

// Frames each way, and either close ends both. The relay reads nothing: what travels is the
// engine protocol, which is the browser's business and not the registry's.
function pipe(client: WebSocket, upstream: WebSocket): void {
  const shut = (ws: WebSocket) => {
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
  upstream.on("message", (d, isBinary) => {
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

/**
 * Relay `/api/engine/<id>/ws` to the engine itself.
 *
 * Attached to the HTTP SERVER rather than mounted as a route, because an upgrade never reaches
 * Express's middleware chain — which is also why the session cookie cannot gate it, and why
 * there is a ticket at all (the same reason k7's signaling has one; see apps/k7/backend/src/rtc.ts).
 *
 * The target comes from the REGISTRY, never from the request: a `?host=&port=` would have made
 * every backend an open relay to anything it can reach.
 */
export function attachEngineProxy(server: Server, reg: EngineRegistry): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return; // not a URL we can read — leave it for another handler
    }
    const m = WS_ROUTE.exec(url.pathname);
    if (!m) return; // not ours

    const id = decodeURIComponent(m[1]);
    if (verifyEngineTicket(url.searchParams.get("ticket") || "") !== id)
      return deny(socket, "401 Unauthorized");
    const engine = reg.get(id);
    if (!engine) return deny(socket, "404 Not Found");

    wss.handleUpgrade(req, socket, head, (client) => {
      // Buffered, because the browser sends `whoami` the instant the socket opens and the
      // upstream one is still being dialled. Dropping it would make every probe time out —
      // the relay would be "reachable" and answer nothing, which is worse than unreachable.
      const pending: { data: WebSocket.RawData; binary: boolean }[] = [];
      const hold = (data: WebSocket.RawData, binary: boolean) =>
        pending.push({ data, binary });
      client.on("message", hold);

      void dial(engine).then((upstream) => {
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

/**
 * Relay `/api/engine/<id>/files/*` to the engine machine's file service.
 *
 * The same wall as the WebSocket: the file service answers on `http://<lan-ip>:<filePort>`, and
 * an HTTPS page may not fetch that either. An ordinary Express route this time — a plain
 * request needs no upgrade — so the session middleware already in front of `/api/engine`
 * gates it, and it carries no ticket.
 */
export function engineFilesProxy(reg: EngineRegistry): RequestHandler {
  return (req, res) => {
    const engine = reg.get(String(req.params.id));
    if (!engine) return void res.status(404).json({ error: "unknown engine" });
    // Express strips the mount path; `req.url` is what remains, which is the file service's own.
    const path = req.url.startsWith("/") ? req.url : `/${req.url}`;
    const hosts = hostsFor(engine);

    const attempt = (i: number): void => {
      const host = hosts[i];
      if (!host)
        return void res
          .status(502)
          .json({ error: "engine file service unreachable from the server" });
      const up = httpRequest(
        {
          host,
          port: engine.addresses.filePort,
          path,
          method: req.method,
          headers: {
            ...req.headers,
            host: `${host}:${engine.addresses.filePort}`,
          },
          timeout: DIAL_TIMEOUT_MS,
        },
        (upRes) => {
          res.status(upRes.statusCode ?? 502);
          for (const [k, v] of Object.entries(upRes.headers))
            if (v !== undefined && k.toLowerCase() !== "transfer-encoding")
              res.setHeader(k, v as string | string[]);
          upRes.pipe(res);
        },
      );
      // Only a host that never answered is worth retrying on the next one — once bytes are
      // flowing the response is committed and a second attempt would write it twice.
      up.on("error", () => {
        if (!res.headersSent) attempt(i + 1);
        else res.end();
      });
      up.on("timeout", () => up.destroy());
      req.pipe(up);
    };
    attempt(0);
  };
}
