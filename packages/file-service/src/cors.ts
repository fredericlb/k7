// cors.ts — which browser origins may call this service. CORS is the load-bearing
// control here, not a formality: a refused preflight is what stops a page you happen to
// visit from driving the service. The one rule: NEVER reflect an arbitrary origin.
// Full rationale: docs/corsAndOrigins.md.

import { readFileSync, statSync } from "node:fs";
import { webOriginsPath } from "@studio/engine-client/paths";
import { normaliseBrowserOrigin } from "@studio/engine-host/webOrigins";

/** Loopback + RFC1918 IPv4, and the loopback names. */
const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function originsFromEnv(): string[] | null {
  const raw = process.env.STUDIO_WEB_ORIGIN;
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
    // Through the SAME function the writer uses; a bare `new URL().origin` accepts `*` and drops credentials.
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

// The hosted backends' origins, PLURAL and comma-separated — see docs/corsAndOrigins.md.
function registryOrigins(): string[] {
  const raw = process.env.STUDIO_REGISTRY_URL;
  if (!raw) return [];
  const out: string[] = [];
  for (const url of raw.split(",")) {
    try {
      out.push(new URL(url.trim()).origin);
    } catch {
      /* one bad URL must not cost the others their origin */
    }
  }
  return out;
}

/** Decide whether `origin` may call this service — the whole policy is in docs/corsAndOrigins.md. */
export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // not a browser — nothing to protect against here

  const explicit = originsFromEnv();
  if (explicit) return explicit.includes(origin);

  if (registryOrigins().includes(origin)) return true;

  // Web UIs the user added from the tray. Re-read per call, so one takes effect without restarting this service.
  if (originsFromFile().includes(origin)) return true;

  // The dev frontend and Tier 2 under one rule: any http origin on a loopback or private address, any port.
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
  if (explicit) return `STUDIO_WEB_ORIGIN=${explicit.join(", ")}`;
  const added = originsFromFile();
  const parts = [
    // All of them: hiding the second registry would hide the likeliest refusal from the boot log.
    ...registryOrigins(),
    ...added,
    "loopback + private-network http origins",
  ];
  // The added ones are re-read per request, so this line is a snapshot at boot, not the list for the process's life.
  return `${parts.join(", ")}${added.length ? " (web-origins.json, live)" : ""} (set STUDIO_WEB_ORIGIN to restrict)`;
}
