// upgrade.ts — how every server-side WebSocket in this repo is accepted: `acceptSocket` puts an
// `error` listener on the socket before anything else sees it, since `ws` THROWS an error nobody
// listens to, and one malformed frame would end the process. `heartbeat` drops a peer that stopped
// answering pings. See docs/upgrade.md.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket, WebSocketServer } from "ws";

/** How often a peer is pinged; one that missed the previous ping is terminated. */
export const HEARTBEAT_MS = 30_000;

/** Complete an upgrade on `wss`; the socket handed to `serve` already ends itself on any error. */
export function acceptSocket(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  serve: (ws: WebSocket) => void,
  onError?: (e: Error) => void,
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on("error", (e) => {
      onError?.(e);
      ws.terminate();
    });
    serve(ws);
  });
}

/** Ping `ws` every `everyMs` and terminate it once a ping went unanswered; stops with the socket. */
export function heartbeat(ws: WebSocket, everyMs = HEARTBEAT_MS): void {
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }, everyMs);
  timer.unref?.();
  ws.once("close", () => clearInterval(timer));
}
