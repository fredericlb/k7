// webOrigins.ts — the web UIs this engine trusts (~/.studio/web-origins.json), so a
// UI on a real hostname can pass the file service's deny-by-default CORS. Written here
// because the SUPERVISOR is the writer; file-service imports it to read. Only bare
// origins are stored. Full rationale: docs/supervisorPolicy.md.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  pendingOriginsPath,
  webOriginsPath,
} from "@studio/engine-client/paths";
import { DEFAULT_STUDIO_URL } from "./registryClient.ts";

export const WEB_ORIGINS_PATH = webOriginsPath();
export const PENDING_ORIGINS_PATH = pendingOriginsPath();

// --- normalisation: the security boundary ------------------------------------
// These gate what the file service answers. Node's `URL` gets the hard parts right for free, but is NOT enough:
// `*` is not a forbidden host code point, so `https://*.example.com` stores as a pattern that expands to nothing,
// and `.origin` silently DISCARDS credentials, turning a paste mistake into a trusted entry nobody read.

// The shared strict core. `url` must already carry a scheme.
function originOf(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Rejected, not dropped — see the note above.
  if (url.username !== "" || url.password !== "") return null;
  if (!url.hostname || url.hostname.includes("*")) return null;
  // For http/https this is the origin exactly as a browser sends it; other schemes serialise "null", never stored.
  const origin = url.origin;
  if (!origin || origin === "null") return null;
  return origin;
}

/**
 * Reduce whatever the USER typed to a bare origin, or null if it isn't a usable
 * absolute http(s) URL.
 *
 * Deliberately strict: this widens a security boundary, so a typo should fail visibly
 * rather than land as an entry that never matches (or, worse, as something broader
 * than intended). A bare host gets `https://` rather than being rejected — typing
 * "daw.test" into a menu-bar prompt is the obvious thing to do.
 */
export function normaliseUserOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  return originOf(url);
}

/**
 * Reduce an origin that should ALREADY be one — a stored entry, or a browser's
 * `Origin` header — to its canonical form, or null if it isn't usable.
 *
 * No scheme guessing here: unlike the prompt, nothing on this path is a human typing.
 * A bare host arriving from a browser or a hand-edited file is malformed, and treating
 * it as https:// would invent an authorisation nobody granted.
 */
export function normaliseBrowserOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw?.includes("://")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return originOf(url);
}

// --- the allowlist -----------------------------------------------------------

interface OriginsFile {
  origins?: unknown;
}

/** The saved web UI origins. A missing or malformed file reads as empty — the file
 *  service treats it the same way, so the two can't disagree about a broken file. */
export function loadOrigins(): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(WEB_ORIGINS_PATH, "utf8"),
    ) as OriginsFile;
    if (!Array.isArray(parsed?.origins)) return [];
    return parsed.origins.filter((o): o is string => typeof o === "string");
  } catch {
    return [];
  }
}

export function saveOrigins(origins: string[]): void {
  try {
    mkdirSync(dirname(WEB_ORIGINS_PATH), { recursive: true });
    writeFileSync(
      WEB_ORIGINS_PATH,
      `${JSON.stringify({ origins }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* unwritable home — the list stays as it was; the caller sees no change */
  }
}

/** First-run seed: the hosted studio is a trusted web UI out of the box. Only when no
 *  origins file exists yet — this is a DEFAULT, not an enforcement, so a user who
 *  removes the entry (the file then exists, empty or not) must never see it return. */
export function seedDefault(path: string = WEB_ORIGINS_PATH): void {
  if (existsSync(path)) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ origins: [DEFAULT_STUDIO_URL] }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* unwritable home — cors.ts still admits the registry origin, so this degrades
       to "the hosted studio needs one manual approval" rather than to a failure */
  }
}

/** Add an origin (idempotent). Returns the normalised origin actually stored, or null
 *  when the input isn't a usable URL. */
export function addOrigin(input: string): string | null {
  const origin = normaliseUserOrigin(input);
  if (!origin) return null;
  const list = loadOrigins();
  if (!list.includes(origin)) saveOrigins([...list, origin]);
  return origin;
}

/** Remove an origin. No-op when it isn't there. */
export function removeOrigin(origin: string): void {
  const list = loadOrigins();
  const kept = list.filter((o) => o !== origin);
  if (kept.length !== list.length) saveOrigins(kept);
}

// --- origins the file service refused, offered for approval ------------------
// The other half of "add a web UI", and the one that works everywhere: the blocked browser names itself, the
// file service records it, and the tray offers one click. This is a list of QUESTIONS — nothing here grants.

const STALE_MS = 30 * 60 * 1000; // matches pendingOrigins.ts's TTL

interface PendingEntry {
  origin?: unknown;
  lastSeen?: unknown;
}

/** The filtering half of `pendingOrigins`, split out so it can be tested without a
 *  home dir. */
export function parsePending(
  text: string,
  allowed: string[],
  now: number,
): string[] {
  let rows: PendingEntry[];
  try {
    const f = JSON.parse(text) as { pending?: unknown };
    if (!Array.isArray(f?.pending)) return [];
    rows = f.pending as PendingEntry[];
  } catch {
    return [];
  }
  return (
    rows
      .filter(
        (e): e is { origin: string; lastSeen: number } =>
          typeof e?.origin === "string" && e.origin !== "",
      )
      .map((e) => ({
        origin: e.origin,
        lastSeen: typeof e.lastSeen === "number" ? e.lastSeen : 0,
      }))
      // An already-allowed origin must never appear as a question; the two files are written by different processes.
      .filter((e) => !allowed.includes(e.origin))
      // A stale entry is a trap, not a hint: approving what you opened half an hour ago is approving the unidentifiable.
      .filter((e) => e.lastSeen === 0 || now - e.lastSeen <= STALE_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((e) => e.origin)
  );
}

/** Recently-refused origins, newest first, excluding any that are already allowed. */
export function pendingOrigins(): string[] {
  let text = "";
  try {
    text = readFileSync(PENDING_ORIGINS_PATH, "utf8");
  } catch {
    return [];
  }
  return parsePending(text, loadOrigins(), Date.now());
}

/** Drop an origin from the pending list — after allowing it, or dismissing it. */
export function clearPending(origin: string): void {
  let rows: PendingEntry[];
  try {
    const f = JSON.parse(readFileSync(PENDING_ORIGINS_PATH, "utf8")) as {
      pending?: unknown;
    };
    if (!Array.isArray(f?.pending)) return;
    rows = f.pending as PendingEntry[];
  } catch {
    return;
  }
  const kept = rows.filter((e) => e?.origin !== origin);
  if (kept.length === rows.length) return;
  try {
    writeFileSync(
      PENDING_ORIGINS_PATH,
      `${JSON.stringify({ pending: kept }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* the writer will rewrite the file on its next refusal anyway */
  }
}

/** A cheap "has the pending list moved?" probe, so a polling loop can skip the parse.
 *  mtime+size, the same trick cors.ts uses for web-origins.json. */
export function pendingStamp(): string {
  try {
    const s = statSync(PENDING_ORIGINS_PATH);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "";
  }
}
