// registryClient.ts — the outbound link from the engine to the web server's
// registry. The engine dials nothing for transport (the browser connects to it
// directly); this is only presence: a periodic heartbeat so the server can list
// the engine as available, and a deregister on shutdown so it drops immediately
// instead of waiting out the TTL.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { webEndpointPath, webEndpointsDir } from "@studio/engine-client/paths";
import {
  STUDIO_ORIGIN,
  serviceUrl,
  studioOrigin,
} from "@studio/web-protocol/services";
import type { EnginePresence } from "./addresses.ts";
import type { EngineIdentity } from "./identity.ts";

// The hosted studio: the registry an engine announces to when nothing local is configured, and
// the trusted UI. Re-exported from the one table that owns it, so it cannot drift from the
// service paths derived off it.
export const DEFAULT_STUDIO_URL = STUDIO_ORIGIN;

/**
 * Where the registries live. Resolution, most explicit first, and the FIRST tier that
 * yields anything wins outright — the tiers are alternatives, not a union:
 *
 *   1. `configured` — the ones the user pinned with "Add web UI…". A deliberate,
 *      persisted choice beats an ambient one, which is why it goes above the env var.
 *   2. `$STUDIO_REGISTRY_URL`, comma-separated for more than one.
 *   3. what the local backends advertised — `~/.studio/web-endpoints/*.json`, one file per
 *      service, plus the legacy single `web-endpoint.json` — so a local dev setup still
 *      wins over the hosted default.
 *   4. the hosted studio.
 *
 * A LIST since each hosted service holds its own registry: an engine must be listed in
 * l8 and in the médiathèque to be pickable in both. Deduped, because the same URL
 * arriving twice would mean two heartbeats a tick to one server for nothing.
 */
export function resolveRegistryUrls(configured?: string[] | null): string[] {
  if (configured?.length) return [...new Set(configured)];
  if (process.env.STUDIO_REGISTRY_URL)
    return [
      ...new Set(
        process.env.STUDIO_REGISTRY_URL.split(",")
          .map((u) => u.trim())
          .filter((u) => u !== ""),
      ),
    ];
  const local = advertisedUrls();
  if (local.length) return local;
  return [DEFAULT_STUDIO_URL];
}

/**
 * The hosted médiathèque this machine caches, derived rather than configured.
 *
 * Every service sits on ONE origin at a FIXED path (`SERVICE_PATHS`), so the registry URLs
 * already resolved above carry the only thing that varies — `https://st0.priv.frediver.se` and
 * `https://studio.frediver.se` differ by their origin and nothing else. Asking for the
 * library's URL as well made a second, hand-typed copy of a fact already on disk, which is
 * exactly how a machine ends up heartbeating to one studio and syncing from another.
 *
 * Only the ORIGIN is kept, and the path comes back from the table: a registry URL may be any
 * service's (`…/pl8`, or the bare origin now that l8 answers it), and the médiathèque is under
 * `/pl8`. It used to be the bare origin, and that was one `serviceUrl` call away from being
 * wrong the day the two swapped — which is the case for asking rather than assuming.
 *
 * The `if (origin)` guard is what keeps it honest: an unparseable registry URL yields `""` from
 * `studioOrigin`, and returning that would hand the file service an empty `MEDIATEK_URL` it
 * reads as configured.
 *
 * The FIRST registry wins: `resolveRegistryUrls` returns one tier's worth of alternatives, and
 * a machine pinned to several studios caches from the one it announces to first.
 */
export function mediatekUrlFor(registryUrls: string[]): string | null {
  for (const u of registryUrls) {
    const origin = studioOrigin(u);
    if (origin) return serviceUrl(origin, "pl8");
  }
  return null; // nothing resolvable — the local folder is then a cache of nothing, which works
}

/** `.url` out of one endpoint file, or null for anything that isn't one. */
function urlIn(path: string): string | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v.url === "string" && v.url !== "" ? v.url : null;
  } catch {
    return null; // absent, or half-written by a backend booting right now
  }
}

/**
 * Every registry a local backend advertised, deduped.
 *
 * The DIRECTORY is the contract; the single `web-endpoint.json` is read too because an older
 * l8 backend still writes only that one, and a tray shipped before this change reads only
 * that one. Both are cheap, and the union is what stops a version skew from silently costing
 * an app its engine.
 */
function advertisedUrls(): string[] {
  const out: string[] = [];
  try {
    for (const name of readdirSync(webEndpointsDir()))
      if (name.endsWith(".json")) {
        const url = urlIn(join(webEndpointsDir(), name));
        if (url) out.push(url);
      }
  } catch {
    /* no directory yet — the legacy file may still answer */
  }
  const legacy = urlIn(webEndpointPath());
  if (legacy) out.push(legacy);
  return [...new Set(out)];
}

export interface HeartbeatBody extends EnginePresence {
  id: string;
  token: string;
}

// Every call is bounded: a registry that connects and never answers is harmless on a heartbeat but fatal on
// the deregister, which runs while the user waits for the app to quit.
const REQUEST_TIMEOUT_MS = 1500;

async function post(
  url: string,
  path: string,
  body: unknown,
): Promise<boolean> {
  try {
    const res = await fetch(url.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false; // not up yet, or too slow to matter; the next tick retries
  }
}

/**
 * Announce to every registry, in parallel. Resolves true only if they ALL answered.
 *
 * All-or-nothing because the tray shows one light, and "ok" has to mean every service can
 * offer this engine. A registry that is down is simply absent from that service's picker —
 * correct, since that service genuinely cannot be driven right now.
 */
export async function heartbeat(
  registryUrls: string[],
  identity: EngineIdentity,
  presence: EnginePresence,
): Promise<boolean> {
  const body: HeartbeatBody = {
    id: identity.id,
    token: identity.token,
    ...presence,
  };
  const results = await Promise.all(
    registryUrls.map((u) => post(u, "/api/registry/heartbeat", body)),
  );
  return results.length > 0 && results.every(Boolean);
}

/** Drop out of every registry. Parallel, because this runs while the user waits to quit. */
export async function deregister(
  registryUrls: string[],
  identity: EngineIdentity,
): Promise<boolean> {
  const results = await Promise.all(
    registryUrls.map((u) =>
      post(u, "/api/registry/deregister", {
        id: identity.id,
        token: identity.token,
      }),
    ),
  );
  return results.every(Boolean);
}
