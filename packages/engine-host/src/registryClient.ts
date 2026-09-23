// registryClient.ts — the outbound link from the engine to the web server's
// registry. The engine dials nothing for transport (the browser connects to it
// directly); this is only presence: a periodic heartbeat so the server can list
// the engine as available, and a deregister on shutdown so it drops immediately
// instead of waiting out the TTL.

import { serviceUrl, studioOrigin } from "@studio/web-protocol/services";
import type { EnginePresence } from "./addresses.ts";
import type { EngineIdentity } from "./identity.ts";

/** Where the registries live: what the user added, else `$STUDIO_REGISTRY_URL`, else nothing — a machine connected to no st0 instance. What local backends advertise is NOT read: see docs/supervisorPolicy.md. */
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
  return [];
}

/** The hosted médiathèque this machine caches, DERIVED from the registry origins rather than configured — see docs/supervisorPolicy.md. */
export function mediatekUrlFor(registryUrls: string[]): string | null {
  for (const u of registryUrls) {
    const origin = studioOrigin(u);
    if (origin) return serviceUrl(origin, "pl8");
  }
  return null; // nothing resolvable — the local folder is then a cache of nothing, which works
}

export interface HeartbeatBody extends EnginePresence {
  id: string;
  token: string;
}

// Every call is bounded: a registry that connects and never answers is harmless on a heartbeat and fatal on the deregister.
const REQUEST_TIMEOUT_MS = 1500;

/** The one outbound TLS in this process; everything else it dials is loopback. */
let send: typeof fetch = (...a) => globalThis.fetch(...a);

/** Whose network stack the heartbeat rides — the private-CA question, docs/supervisorPolicy.md. */
export function setRegistryFetch(f: typeof fetch | null): void {
  send = f ?? ((...a) => globalThis.fetch(...a));
}

async function post(
  url: string,
  path: string,
  body: unknown,
): Promise<boolean> {
  try {
    const res = await send(url.replace(/\/$/, "") + path, {
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

/** Announce to every registry in parallel, true only if they ALL answered — all-or-nothing, because the tray shows one light. */
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
