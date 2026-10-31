// consolidation.ts — the rules of consolidating a moment from a local instance, apart from React: it goes to the
// account's ACTIVE server, and only when that server answers and does not hold it yet.
// See ../docs/recordings.md, "A moment is consolidated on a server".

import type { Consolidation, ConsolidationServer } from "./types";

/** A server's host, from its origin; the origin itself when it does not parse. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** How a server reads in the dialog and on a consolidated moment: `host · account`. */
export const serverLabel = (s: { origin: string; as: string }): string =>
  `${hostOf(s.origin)} · ${s.as}`;

/** Why the moment cannot be sent to `server` now, or null when it can. */
export function sendRefusal(
  server: ConsolidationServer | null,
  done: readonly Consolidation[] = [],
): "none" | "already" | "offline" | null {
  if (!server) return "none";
  if (done.some((c) => c.link === server.id)) return "already";
  return server.online ? null : "offline";
}
