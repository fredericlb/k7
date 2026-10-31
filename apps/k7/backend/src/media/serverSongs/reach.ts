// reach.ts — whether the paired server answers right now: one cheap ping, remembered a few seconds, and noted by
// every other call that reached it or failed to. A phone reads it to decide whether a song can be edited.
// See packages/mediatek/docs/serverCopy.md.

import { deviceGet, type PairedServer } from "./server.ts";

/** How long one answer stands before the server is asked again. */
const KEEP_MS = 15_000;
/** A ping longer than this means away: a phone in a tunnel must not wait for ever. */
const PING_MS = 5_000;

interface Known {
  reachable: boolean;
  at: number;
}

const known = new Map<string, Known>();
const asking = new Map<string, Promise<Known>>();

/** Another call reached the server, or could not: it says as much as a ping. */
export function noteReach(base: string, reachable: boolean): void {
  known.set(base, { reachable, at: Date.now() });
}

/** The server's reach, pinged at most once per KEEP_MS and once at a time. */
export async function reachOf(server: PairedServer): Promise<Known> {
  const k = known.get(server.base);
  if (k && Date.now() - k.at < KEEP_MS) return k;
  const pending = asking.get(server.base);
  if (pending) return pending;
  const ask = deviceGet(server, "/revision", PING_MS).then(
    () => true,
    () => false,
  );
  const p = ask.then((reachable) => {
    noteReach(server.base, reachable);
    asking.delete(server.base);
    return known.get(server.base) as Known;
  });
  asking.set(server.base, p);
  return p;
}
