// registryClient.ts — the outbound link from the engine to the web server's
// registry. The engine dials nothing for transport (the browser connects to it
// directly); this is only presence: a periodic heartbeat so the server can list
// the engine as available, and a deregister on shutdown so it drops immediately
// instead of waiting out the TTL.

import {
  engineRegistryUrl,
  REGISTRY_HELLO_PATH,
  REGISTRY_SERVICE,
} from "@studio/web-protocol/services";
import type { EnginePresence } from "./addresses.ts";
import type { EngineIdentity } from "./identity.ts";

/** Each URL as its family's ONE registry, pl8's, deduped — so a st0 URL an older settings file pinned is migrated in the READER, and st0 and pl8 of one family collapse to one heartbeat. */
function asRegistries(urls: string[]): string[] {
  return [
    ...new Set(
      urls.map((u) => engineRegistryUrl(u.trim())).filter((u) => u !== ""),
    ),
  ];
}

/** Where the registries live: what the user added, else `$STUDIO_REGISTRY_URL`, else nothing — a machine connected to no st0 instance. Always pl8's, and what local backends advertise is NOT read: see docs/supervisorPolicy.md. */
export function resolveRegistryUrls(configured?: string[] | null): string[] {
  if (configured?.length) return asRegistries(configured);
  const env = process.env.STUDIO_REGISTRY_URL;
  if (env) return asRegistries(env.split(","));
  return [];
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

/** Longer than a heartbeat's bound: this one runs once, while someone waits on the form, and a slow first TLS handshake is not a "no". */
const PROBE_TIMEOUT_MS = 5000;

export type RegistryProbe = { ok: true } | { ok: false; why: string };

/** Ask `url` whether it IS an engine registry, before anything is sent there — a heartbeat carries the engine's token. See docs/supervisorPolicy.md. */
export async function probeRegistry(url: string): Promise<RegistryProbe> {
  let res: Response;
  try {
    res = await send(url.replace(/\/$/, "") + REGISTRY_HELLO_PATH, {
      // A redirect is refused, not followed: the answer must come from the address the token would go to.
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, why: `${url} did not answer` };
  }
  const body = res.ok ? await res.json().catch(() => null) : null;
  if (body?.service === REGISTRY_SERVICE) return { ok: true };
  return { ok: false, why: `${url} is not an st0 instance` };
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
