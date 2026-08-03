// registryClient.ts — the outbound link from the engine to the web server's
// registry. The engine dials nothing for transport (the browser connects to it
// directly); this is only presence: a periodic heartbeat so the server can list
// the engine as available, and a deregister on shutdown so it drops immediately
// instead of waiting out the TTL.

import { readFileSync } from "node:fs";
import { webEndpointPath } from "@studio/engine-client/paths";
import type { EnginePresence } from "./addresses.ts";
import type { EngineIdentity } from "./identity.ts";

// The hosted studio: the registry an engine announces to when nothing local is configured, and the trusted UI.
export const DEFAULT_STUDIO_URL = "https://studio.frediver.se";

/**
 * Where the registries live. Resolution, most explicit first, and the FIRST tier that
 * yields anything wins outright — the tiers are alternatives, not a union:
 *
 *   1. `configured` — the ones the user pinned with "Add web UI…". A deliberate,
 *      persisted choice beats an ambient one, which is why it goes above the env var.
 *   2. `$STUDIO_REGISTRY_URL`, comma-separated for more than one.
 *   3. `~/.studio/web-endpoint.json` `.url`, written by the backend on boot — so a
 *      local dev setup still wins over the hosted default.
 *   4. the hosted studio.
 *
 * A LIST since each hosted service holds its own registry: an engine must be listed in
 * pistes and in the médiathèque to be pickable in both. Deduped, because the same URL
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
  try {
    const v = JSON.parse(readFileSync(webEndpointPath(), "utf8"));
    if (v && typeof v.url === "string" && v.url !== "") return [v.url];
  } catch {
    /* no endpoint file yet — fall through to the default */
  }
  return [DEFAULT_STUDIO_URL];
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
