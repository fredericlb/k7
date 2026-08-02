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

type Role = "recorder" | "remote";

// One signaling room per user, holding at most one socket in each role — the
// "only one remote" rule falls out of the single `remote` slot.
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

// Attach the signaling server to the shared HTTP server, handling upgrades on
// the /rtc path only (everything else is left for other handlers / rejected).
export function attachRtc(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

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
      register(ws, userId, role);
    });
  });
}

function register(ws: WebSocket, userId: string, role: Role): void {
  const room = rooms.get(userId) ?? {};
  rooms.set(userId, room);

  // A newcomer replaces any existing socket in the same role (e.g. the remote
  // reconnecting after a refresh): the newest device wins, the stale one is
  // closed so it stops thinking it's live.
  const previous = room[role];
  if (previous && previous !== ws) {
    send(previous, { type: "replaced" });
    previous.close(4000, "replaced");
  }
  room[role] = ws;

  const peerRole: Role = role === "recorder" ? "remote" : "recorder";
  // Tell the newcomer whether its peer is already here, and tell the peer that
  // someone just joined.
  send(ws, {
    type: "peer-present",
    present: room[peerRole]?.readyState === WebSocket.OPEN,
  });
  send(room[peerRole], { type: "peer-online" });

  ws.on("message", (data) => {
    // Signaling payloads (offer/answer/ice/want) are relayed verbatim to the
    // peer; the server never inspects them.
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
