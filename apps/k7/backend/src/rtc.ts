/* WebRTC signaling for remote-microphone recording.

   Two browsers take part per user: the "recorder" (the main device running the
   app) and the "remote" (a second device opened at /remote whose microphone we
   want to use). They establish a peer-to-peer WebRTC audio connection; this
   module is only the signaling relay that carries the offer/answer/ICE messages
   between them. The audio itself never touches the server.

   Auth: the WebSocket upgrade can't easily read the stateless signed session
   cookie, so the authenticated SPA first fetches a short-lived HMAC "ticket"
   (see the /api/rtc/ticket route) and presents it on the ws:// URL. The ticket
   binds the connection to a user id, which scopes the signaling room.
*/

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "./env.ts";

const SECRET = env.sessionSecret;
const TICKET_TTL_MS = 60_000; // a ticket only needs to survive the ws handshake
// Signalling is SDP and ICE — a few KB. ws's default ceiling is 100 MiB, relayed verbatim to the peer.
const MAX_MESSAGE_BYTES = 64 * 1024;
// A phone that sleeps leaves its socket OPEN to us for as long as TCP takes to notice: a missed pong ends it sooner.
const HEARTBEAT_MS = 15_000;

type Role = "recorder" | "remote";

// One room per user, one socket per role: "only one remote" falls out of the single slot.
interface Room {
  recorder?: WebSocket;
  remote?: WebSocket;
}
const rooms = new Map<string, Room>();

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", SECRET).update(payload).digest());
}

/** Mint a signed ticket binding a ws connection to this user for ~1 minute. */
export function issueTicket(userId: string): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ sub: userId, exp: Date.now() + TICKET_TTL_MS }),
    ),
  );
  return `${payload}.${sign(payload)}`;
}

/** Verify a ticket and return its user id, or null if invalid/expired. */
export function verifyTicket(token: string): string | null {
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  // Constant-time compare over equal-length buffers.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { sub, exp } = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    );
    if (!sub || typeof exp !== "number" || exp < Date.now()) return null;
    return String(sub);
  } catch {
    return null;
  }
}

/** Whether a remote microphone device is currently connected for this user. */
export function hasRemote(userId: string): boolean {
  return rooms.get(userId)?.remote?.readyState === WebSocket.OPEN;
}

function send(ws: WebSocket | undefined, msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Signaling onto the shared HTTP server, taking upgrades on the /rtc path alone.
export function attachRtc(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  // A socket that did not answer the last ping is gone; `close` then runs its cleanup as for any other.
  const alive = new WeakMap<WebSocket, boolean>();
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  beat.unref();
  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
  });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/rtc") return; // not ours — leave it alone

    const userId = verifyTicket(url.searchParams.get("ticket") || "");
    const role = url.searchParams.get("role");
    if (!userId || (role !== "recorder" && role !== "remote")) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      register(ws, userId, role);
    });
  });
}

function register(ws: WebSocket, userId: string, role: Role): void {
  const room = rooms.get(userId) ?? {};
  rooms.set(userId, room);

  // A newcomer replaces its role's socket: the newest device wins, the stale one is closed.
  const previous = room[role];
  if (previous && previous !== ws) {
    send(previous, { type: "replaced" });
    previous.close(4000, "replaced");
  }
  room[role] = ws;

  const peerRole: Role = role === "recorder" ? "remote" : "recorder";
  // Tell the newcomer whether its peer is here, and the peer that someone joined.
  send(ws, {
    type: "peer-present",
    present: room[peerRole]?.readyState === WebSocket.OPEN,
  });
  send(room[peerRole], { type: "peer-online" });

  ws.on("message", (data) => {
    // Payloads are relayed verbatim to the peer; the server never inspects them.
    const peer = rooms.get(userId)?.[peerRole];
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(data.toString());
  });

  ws.on("close", () => {
    const r = rooms.get(userId);
    if (!r) return;
    if (r[role] === ws) {
      r[role] = undefined;
      send(r[peerRole], { type: "peer-offline" });
    }
    if (!r.recorder && !r.remote) rooms.delete(userId);
  });

  ws.on("error", () => ws.close());
}
