// server.ts — a paired server as this machine's backend calls it: its origin, the device token, and the read-only
// door it answers a device's library reads on. Shared by the placement routes, the downloads and the update check.
// See packages/mediatek/docs/serverCopy.md.

import { pairedServers } from "@studio/file-hub/sync-remote";
import type { Manifest } from "@studio/mediatek/manifest";
import type { Family } from "@studio/mediatek/types";

/** Where the origin answers a paired device's reads, behind its device token. */
export const DEVICE_LIBRARY_ROUTE = "/api/sync/mediatek";

export interface PairedServer {
  base: string;
  token: string;
}

/** One GET on the server's device door, bounded by `ms`; throws on a refusal as on a network failure. */
export async function deviceGet<T>(
  server: PairedServer,
  path: string,
  ms: number,
): Promise<T> {
  const got = await fetch(`${server.base}${DEVICE_LIBRARY_ROUTE}${path}`, {
    headers: { authorization: `Bearer ${server.token}` },
    signal: AbortSignal.timeout(ms),
  });
  if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
  return (await got.json()) as T;
}

/** A family's manifest on the server, with the revision it was read at: what a sidecar records. */
export const serverManifest = (
  server: PairedServer,
  family: Family,
): Promise<{ rev: string; files: Manifest }> =>
  deviceGet(server, `/manifest?family=${family}`, 2 * 60_000);

/** Every server this machine's accounts are paired with, by origin: what a job with no request to read reaches. */
export function machineServers(filesRoot: string): PairedServer[] {
  return pairedServers(filesRoot).map((p) => ({
    base: p.origin,
    token: p.token,
  }));
}
