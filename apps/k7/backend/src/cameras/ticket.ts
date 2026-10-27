// ticket.ts — what opens the camera socket: a short-lived HMAC binding one ACCOUNT, minted by a
// session-guarded route, because a WebSocket upgrade skips Express and its guards. The secret is
// per process: a restart only costs a socket its next reconnect. See ../../docs/cameras.md.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RTCIceServerLike } from "@studio/web-protocol/cameras";

/** Long enough for the handshake it was minted for, and no longer. */
const TICKET_TTL_MS = 60_000;

export interface Tickets {
  issue(account: string): string;
  /** The account a ticket is good for, or null when it is forged, expired or malformed. */
  verify(ticket: string): string | null;
}

export function cameraTickets(secret: Buffer = randomBytes(32)): Tickets {
  const sign = (payload: string): string =>
    createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    issue(account) {
      const payload = Buffer.from(
        JSON.stringify({ a: account, e: Date.now() + TICKET_TTL_MS }),
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    verify(ticket) {
      const [payload, sig] = String(ticket).split(".");
      if (!payload || !sig) return null;
      const a = Buffer.from(sig);
      const b = Buffer.from(sign(payload));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      try {
        const { a: account, e } = JSON.parse(
          Buffer.from(payload, "base64url").toString(),
        );
        if (typeof account !== "string" || !account) return null;
        return typeof e === "number" && e >= Date.now() ? account : null;
      } catch {
        return null;
      }
    },
  };
}

/** `K7_CAMERA_ICE_SERVERS`: a JSON array of RTCIceServer, or comma-separated URLs; unset is none, which is one network only. */
export function iceServersFromEnv(raw: string | undefined): RTCIceServerLike[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const list = JSON.parse(text) as RTCIceServerLike[];
      return Array.isArray(list) ? list.filter((s) => s?.urls) : [];
    } catch {
      console.warn("K7_CAMERA_ICE_SERVERS is not valid JSON — ignored");
      return [];
    }
  }
  return text
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));
}
