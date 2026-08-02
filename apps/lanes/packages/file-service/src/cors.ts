// cors.ts — which browser origins may call this service. CORS is the load-bearing
// control here, not a formality: a refused preflight is what stops a page you happen to
// visit from driving the service. The one rule: NEVER reflect an arbitrary origin.
// Full rationale: docs/corsAndOrigins.md.

import { readFileSync, statSync } from "node:fs";
import { webOriginsPath } from "@lanes/engine-client/paths";
import { normaliseBrowserOrigin } from "@lanes/engine-host/webOrigins";

/** Loopback + RFC1918 IPv4, and the loopback names. */
const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function originsFromEnv(): string[] | null {
  const raw = process.env.LANES_WEB_ORIGIN;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

// --- the user's own web UIs, added from the tray (see docs/corsAndOrigins.md) ---
// Read on EVERY call, memoised by mtime/size, so a tray addition takes effect next request.
const ORIGINS_PATH = webOriginsPath();
let cached: { key: string; origins: string[] } = { key: "", origins: [] };

function originsFromFile(): string[] {
  let key: string;
  try {
    const st = statSync(ORIGINS_PATH);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    // No file yet (the common case) — nothing to allow.
    cached = { key: "", origins: [] };
    return cached.origins;
  }
  if (key === cached.key) return cached.origins;

  let origins: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(ORIGINS_PATH, "utf8"));
    const list = Array.isArray(raw?.origins) ? raw.origins : [];
    // Through the SAME function the writer uses: a bare `new URL().origin` accepts `*` and drops credentials, so a
    // hand-edited entry could read back as one nobody approved.
    origins = list
      .filter((o: unknown): o is string => typeof o === "string" && !!o)
      .map((o: string) => normaliseBrowserOrigin(o) ?? "")
      .filter(Boolean);
  } catch {
    // Malformed or half-written: trust nothing rather than take the service down.
    origins = [];
  }
  cached = { key, origins };
  return origins;
}

// The hosted backend's origin — behind a proxy the frontend shares it, covering the deployed case unconfigured.
function registryOrigin(): string | null {
  const url = process.env.LANES_REGISTRY_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Decide whether `origin` may call this service: `LANES_WEB_ORIGIN` alone when set
 * (a total escape hatch that outranks the tray's list), else the registry's origin +
 * the tray's allowlist + any loopback/private http origin. No Origin header at all is
 * allowed — CORS is browser-only, and refusing curl buys nothing.
 */
export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // not a browser — nothing to protect against here

  const explicit = originsFromEnv();
  if (explicit) return explicit.includes(origin);

  if (origin === registryOrigin()) return true;

  // Web UIs the user added from the tray. Re-read per call, so one takes effect without restarting this service.
  if (originsFromFile().includes(origin)) return true;

  // The dev frontend and Tier 2 (an engine driven from the LAN, whose origin can't be listed ahead of time), under
  // one rule: any http origin on a loopback or private address, any port. It is the HOST that carries the trust,
  // and a page served from a public hostname always presents that public origin — it can never claim 192.168.x.y.
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** One-line summary of the effective policy, for the startup log. */
export function originPolicySummary(): string {
  const explicit = originsFromEnv();
  if (explicit) return `LANES_WEB_ORIGIN=${explicit.join(", ")}`;
  const reg = registryOrigin();
  const added = originsFromFile();
  const parts = [
    ...(reg ? [reg] : []),
    ...added,
    "loopback + private-network http origins",
  ];
  // The added ones are re-read per request, so this line is a snapshot at boot, not the list for the process's life.
  return `${parts.join(", ")}${added.length ? " (web-origins.json, live)" : ""} (set LANES_WEB_ORIGIN to restrict)`;
}
