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
 * Where the web server (and its registry) lives. Resolution, most explicit first:
 *
 *   1. `configured` — the setting the user pinned with "Add web UI…". A deliberate,
 *      persisted choice beats an ambient one, which is why it goes above the env var.
 *   2. `$LANES_REGISTRY_URL`.
 *   3. `~/.lanes/web-endpoint.json` `.url`, written by the backend on boot — so a
 *      local dev setup still wins over the hosted default.
 *   4. the hosted studio.
 */
export function resolveRegistryUrl(configured?: string | null): string {
  if (configured) return configured;
  if (process.env.LANES_REGISTRY_URL) return process.env.LANES_REGISTRY_URL;
  try {
    const v = JSON.parse(readFileSync(webEndpointPath(), "utf8"));
    if (v && typeof v.url === "string" && v.url !== "") return v.url;
  } catch {
    /* no endpoint file yet — fall through to the default */
  }
  return DEFAULT_STUDIO_URL;
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

export function heartbeat(
  registryUrl: string,
  identity: EngineIdentity,
  presence: EnginePresence,
): Promise<boolean> {
  const body: HeartbeatBody = {
    id: identity.id,
    token: identity.token,
    ...presence,
  };
  return post(registryUrl, "/api/registry/heartbeat", body);
}

export function deregister(
  registryUrl: string,
  identity: EngineIdentity,
): Promise<boolean> {
  return post(registryUrl, "/api/registry/deregister", {
    id: identity.id,
    token: identity.token,
  });
}
