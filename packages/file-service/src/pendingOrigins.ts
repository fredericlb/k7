// pendingOrigins.ts — record origins cors.ts just refused into
// ~/.st0/pending-origins.json, so the tray can offer to allow them with a click.
// Records a QUESTION, never an answer; silent when an operator pinned the origin list;
// bounded and self-expiring. Full rationale: docs/corsAndOrigins.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pendingOriginsPath } from "@studio/engine-client/paths";
import { normaliseBrowserOrigin } from "@studio/engine-host/webOrigins";

const PATH = pendingOriginsPath();

/** At most this many origins are remembered; the least recently seen is dropped. */
const MAX = 10;
/** An origin nobody approved within this long is forgotten. */
const TTL_MS = 30 * 60 * 1000;
/** Don't rewrite the file more often than this, however fast the requests come. */
const WRITE_EVERY_MS = 2000;

export interface PendingOrigin {
  origin: string;
  lastSeen: number;
  count: number;
}

const pending = new Map<string, PendingOrigin>();
let loaded = false;
let lastWrite = 0;
let dirty = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(PATH, "utf8"));
    const list: unknown[] = Array.isArray(raw?.pending) ? raw.pending : [];
    for (const e of list) {
      const o = e as Partial<PendingOrigin>;
      if (typeof o?.origin === "string" && typeof o.lastSeen === "number") {
        pending.set(o.origin, {
          origin: o.origin,
          lastSeen: o.lastSeen,
          count: typeof o.count === "number" ? o.count : 1,
        });
      }
    }
  } catch {
    // Missing or malformed: start empty — the next refusal rewrites it.
  }
}

function prune(now: number): void {
  for (const [k, v] of pending)
    if (now - v.lastSeen > TTL_MS) pending.delete(k);
  // Oldest-first eviction once over the cap.
  if (pending.size > MAX) {
    const byAge = [...pending.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    for (const e of byAge.slice(0, pending.size - MAX))
      pending.delete(e.origin);
  }
}

function flush(now: number): void {
  if (!dirty || now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  dirty = false;
  try {
    mkdirSync(dirname(PATH), { recursive: true });
    const list = [...pending.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    writeFileSync(PATH, `${JSON.stringify({ pending: list }, null, 2)}\n`);
  } catch {
    // Best-effort: a tray hint is not worth failing a request over.
  }
}

/** Note that `origin` was refused. On the CORS hot path, hence an in-memory map with a throttled write. */
export function record(origin: string | undefined): void {
  if (!origin) return;
  if (process.env.STUDIO_WEB_ORIGIN) return; // an operator-pinned list isn't up for negotiation
  // The SAME filter that guards the allowlist — a menu row is one click from being allowed.
  const normalised = normaliseBrowserOrigin(origin);
  if (!normalised) return;

  load();
  const now = Date.now();
  const existing = pending.get(normalised);
  pending.set(normalised, {
    origin: normalised,
    lastSeen: now,
    count: (existing?.count ?? 0) + 1,
  });
  dirty = true;
  prune(now);
  flush(now);
}
