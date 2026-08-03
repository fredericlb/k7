// registry.ts — the in-memory engine registry, so a hosted web UI can list what's
// available. Engines announce themselves with a periodic heartbeat and drop out after
// REGISTRY_TTL_MS of silence. The per-engine token NEVER leaves the server: list() returns
// a token-stripped shape, and verifyToken is what stops a lookalike being selected as a
// real engine's id.

import {
  ENGINE_ASSIGN_TTL_MS,
  type EngineAddresses,
  type PublicEngine,
} from "@studio/web-protocol";

/** No heartbeat for this long ⇒ the engine is presumed gone. (Beats every ~5s.) */
export const REGISTRY_TTL_MS = 15000;

export interface EngineEntry {
  id: string;
  token: string; // secret; never sent to the browser
  hostname: string;
  machineFingerprint: string;
  addresses: EngineAddresses;
  publicIpHint?: string; // the source IP the heartbeat arrived from
  // Epoch ms the assignment was last renewed (a re-POST of /engine/select), or null. A timestamp, not a flag,
  // because the holder is a browser tab: it can only say goodbye best-effort, so "in use" must expire on its own.
  assignedSeen: number | null;
  seen: number; // epoch ms of the last heartbeat
}

export interface HeartbeatInput {
  id: string;
  token: string;
  hostname: string;
  machineFingerprint: string;
  addresses: EngineAddresses;
  publicIpHint?: string;
}

export interface EngineRegistry {
  upsert(input: HeartbeatInput): boolean;
  get(id: string): EngineEntry | undefined;
  verifyToken(id: string, token: string): boolean;
  remove(id: string, token: string): boolean;
  assign(id: string): void;
  release(id: string): void;
  list(requesterIp?: string): PublicEngine[];
}

/**
 * A registry instance.
 *
 * A FACTORY rather than the module-level Map this was as lanes' own file. One process still
 * holds exactly one, so nothing behaves differently today — but module state in a shared
 * package is one instance for every importer that ever appears, and this file now has two
 * services and a test suite ahead of it.
 */
export function createRegistry(): EngineRegistry {
  const engines = new Map<string, EngineEntry>();

  /** Still within its TTL ⇒ some tab is (presumed) driving this engine. */
  const isAssigned = (e: EngineEntry, now = Date.now()): boolean =>
    e.assignedSeen !== null && now - e.assignedSeen < ENGINE_ASSIGN_TTL_MS;

  /** Drop entries whose heartbeat has lapsed, then return the live ones. */
  const live = (): EngineEntry[] => {
    const now = Date.now();
    for (const [id, e] of engines)
      if (now - e.seen >= REGISTRY_TTL_MS) engines.delete(id);
    return [...engines.values()];
  };

  const get = (id: string): EngineEntry | undefined => {
    const e = engines.get(id);
    if (!e) return undefined;
    if (Date.now() - e.seen >= REGISTRY_TTL_MS) {
      engines.delete(id);
      return undefined;
    }
    return e;
  };

  return {
    /**
     * Record a heartbeat (also the first-time registration). An id's token is pinned on
     * first sight: a later heartbeat for the same id with a different token is rejected,
     * so a second process can't hijack an existing engine's entry. Returns false on that
     * mismatch, true otherwise.
     */
    upsert(input) {
      const existing = engines.get(input.id);
      if (existing && existing.token !== input.token) return false;
      engines.set(input.id, {
        id: input.id,
        token: input.token,
        hostname: input.hostname,
        machineFingerprint: input.machineFingerprint,
        addresses: input.addresses,
        publicIpHint: input.publicIpHint,
        assignedSeen: existing?.assignedSeen ?? null,
        seen: Date.now(),
      });
      return true;
    },

    get,

    /** The anti-spoof gate: does this id exist and match this token? */
    verifyToken(id, token) {
      const e = get(id);
      return !!e && e.token === token;
    },

    remove(id, token) {
      const e = engines.get(id);
      if (!e) return true; // already gone — deregister is idempotent
      if (e.token !== token) return false;
      engines.delete(id);
      return true;
    },

    assign(id) {
      const e = get(id);
      if (e) e.assignedSeen = Date.now();
    },

    release(id) {
      const e = get(id);
      if (e) e.assignedSeen = null;
    },

    /** The browser-facing list: live engines, token stripped, tagged with a LAN hint. */
    list(requesterIp) {
      return live().map((e) => ({
        id: e.id,
        hostname: e.hostname,
        addresses: e.addresses,
        assigned: isAssigned(e),
        sameSourceIp:
          !!requesterIp && !!e.publicIpHint && e.publicIpHint === requesterIp,
      }));
    },
  };
}
