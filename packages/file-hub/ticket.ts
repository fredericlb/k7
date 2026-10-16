// ticket.ts — who is calling, carried in the header the file service's gate already reads
// (`x-studio-engine-token`), so a browser reaches the hub across origins with no cookie and no
// change to the dozens of calls that build that header. The ENGINE the caller drives rides after
// a `~`, unsigned on purpose: binding it takes a claim, not a ticket. See docs/fileHub.md.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Long enough for a working session; a page that outlives it asks for another. */
const TICKET_TTL_MS = 12 * 60 * 60_000;

const sign = (key: Buffer, payload: string): string =>
  createHmac("sha256", key).update(payload).digest("base64url");

/** A ticket naming `user`, and whether the session made them an admin, until `now + ttl`. */
export function mintTicket(
  key: Buffer,
  user: string,
  admin = false,
  now = Date.now(),
  ttlMs = TICKET_TTL_MS,
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: user, exp: now + ttlMs, ...(admin ? { a: 1 } : {}) }),
  ).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

/** The user and engine a presented token names, or null when it is forged, expired or malformed. */
export function readTicket(
  key: Buffer,
  presented: string,
  now = Date.now(),
): { user: string; admin: boolean; engineId: string | null } | null {
  const [ticket, engineId] = presented.split("~", 2);
  const [payload, sig] = (ticket ?? "").split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(key, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, exp, a } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (typeof u !== "string" || !u || typeof exp !== "number" || exp < now)
      return null;
    return { user: u, admin: a === 1, engineId: engineId || null };
  } catch {
    return null;
  }
}
