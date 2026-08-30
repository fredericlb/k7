// origin.ts — the one predicate the LAN must not get past. This server binds 0.0.0.0 so a
// second device can reach it, and that is fine for the static app and the engine registry,
// which are engine-token shaped already. It is NOT fine for the pl8 proxy: that carries the
// user's studio ACCOUNT credential, and a LAN peer riding it would simply have the account.
// Nothing shows when this is wrong — only an explicit check finds it.
// See ../../docs/server.md.

import type { Request } from "express";

/** IPv4 loopback, IPv6 loopback, and the v4-mapped form node reports on a dual-stack socket. */
const LOOPBACK = /^(?:::1|::ffff:127\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+)$/;

/**
 * Is this request from THIS machine? Read off the socket, never off a header: `X-Forwarded-For`
 * and friends are written by whoever is calling.
 */
export function isLoopback(req: Pick<Request, "socket">): boolean {
  const addr = req.socket?.remoteAddress;
  return typeof addr === "string" && LOOPBACK.test(addr);
}
