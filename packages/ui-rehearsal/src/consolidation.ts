// consolidation.ts — the server-choice rules of consolidating a moment from a local instance, apart from React.
// The one thing a reader would get wrong: the preselected server is the first ONLINE one in link order, not the main one.
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

/** How a server reads in the dropdown and on a consolidated moment: `host · account`. */
export const serverLabel = (s: { origin: string; as: string }): string =>
  `${hostOf(s.origin)} · ${s.as}`;

/** The servers that may still be chosen: those the moment has not been consolidated on through the same link. */
export function choosable(
  servers: readonly ConsolidationServer[],
  done: readonly Consolidation[] = [],
): ConsolidationServer[] {
  const there = new Set(done.map((c) => c.link));
  return servers.filter((s) => !there.has(s.id));
}

/** The first online server in the order given, or null when none answers. */
export function preselectServer(
  servers: readonly Pick<ConsolidationServer, "id" | "online">[],
): string | null {
  return servers.find((s) => s.online)?.id ?? null;
}
