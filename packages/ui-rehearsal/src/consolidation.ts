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

/** The moments that go up on their own to `server`: this machine's, with audio to send, and never sent there. */
export function momentsToSend<
  M extends {
    id: string;
    sharedFrom: string;
    recordingAvailable: boolean;
    validated: boolean;
    consolidations?: Consolidation[];
  },
>(moments: readonly M[], server: ConsolidationServer | null): M[] {
  if (!server?.online) return [];
  // A moment whose recording is gone and was never cut has nothing to send: offered, it would fail at every pass.
  return moments.filter(
    (m) =>
      !m.sharedFrom &&
      (m.recordingAvailable || m.validated) &&
      sendRefusal(server, m.consolidations) === null,
  );
}
