// registry.ts — the in-memory engine registry, so a hosted web UI can list what's
// available, and the CLAIMS that say which project an engine is driving and for whom.
// Engines announce themselves with a periodic heartbeat and drop out after REGISTRY_TTL_MS of
// silence. list() is token-stripped and verifyToken stops a lookalike claiming a real engine's
// id — but the token is NOT a secret from the browser, whatever this line used to say: docs/token.md.
// The claim's rules — one project per engine, one engine per project, newcomer wins — and why
// they are three rules and not one, are in docs/claim.md.

import { randomBytes } from "node:crypto";
import {
  ENGINE_ASSIGN_TTL_MS,
  type EngineAddresses,
  type PublicEngine,
} from "@studio/web-protocol";

/** No heartbeat for this long ⇒ the engine is presumed gone. (Beats every ~5s.) */
export const REGISTRY_TTL_MS = 15000;

/** One tab holding one engine; its `secret` is what makes takeover work rather than ping-pong — see docs/claim.md. */
export interface EngineHolder {
  /** The launch address — `<repo>/<projet>` — or **null** for a surface that opens on no project, which conflicts with nothing. */
  project: string | null;
  /** The account holding it, for the screen shown to whoever is turned away. */
  holder: string;
  /** Epoch ms of the last renewal. A timestamp, not a flag — see the note on the TTL below. */
  seen: number;
}

export interface EngineEntry {
  id: string;
  token: string; // secret; never sent to the browser
  hostname: string;
  machineFingerprint: string;
  addresses: EngineAddresses;
  publicIpHint?: string; // the source IP the heartbeat arrived from
  // Live holders by their secret, expiring on their own because a holder is a browser tab that may never say goodbye.
  holders: Map<string, EngineHolder>;
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

/** What a browser asks for when it opens a project, or renews having opened one. */
export interface ClaimRequest {
  project: string | null;
  holder: string;
  /** Absent on the first call (an OPEN); present on every renewal. */
  secret?: string;
}

export type ClaimResult =
  | {
      ok: true;
      /** Renew with this. A fresh open mints a new one. */
      secret: string;
      /** Set when this claim displaced somebody — the caller may want to say so. */
      tookOver?: { holder: string; project: string | null };
    }
  /** The caller renewed a claim that is no longer theirs; there is no retry, and WHY it went is part of the answer — see docs/claim.md. */
  | {
      ok: false;
      /** `project` — somebody ELSE has it; `engine` — another project took this machine (`tookFor`); `lapsed` — it simply aged out. */
      lost: "project" | "engine" | "lapsed";
      /** Who holds it now. Empty when there is nobody to name — always so for `lapsed`. */
      heldBy: string;
      /** For `engine`: the project that took the machine. */
      tookFor?: string | null;
    };

export interface EngineRegistry {
  upsert(input: HeartbeatInput): boolean;
  get(id: string): EngineEntry | undefined;
  verifyToken(id: string, token: string): boolean;
  remove(id: string, token: string): boolean;
  claim(id: string, req: ClaimRequest): ClaimResult;
  release(id: string, secret: string): void;
  /** Which engine is driving this project right now, or undefined. */
  engineForProject(project: string): string | undefined;
  list(requesterIp?: string): PublicEngine[];
}

/** A registry instance — a FACTORY rather than a module-level Map, since module state in a shared package is one instance per importer. */
export function createRegistry(): EngineRegistry {
  const engines = new Map<string, EngineEntry>();

  /** Forget the holders whose renewal has lapsed, and answer with the rest. */
  const holdersOf = (e: EngineEntry, now = Date.now()): EngineHolder[] => {
    for (const [secret, h] of e.holders)
      if (now - h.seen >= ENGINE_ASSIGN_TTL_MS) e.holders.delete(secret);
    return [...e.holders.values()];
  };

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

  /** A holder on this engine whose project is not this one; at most one, by rule 2 — see docs/claim.md. */
  const otherProjectOn = (
    e: EngineEntry,
    project: string,
    now = Date.now(),
  ): EngineHolder | undefined =>
    holdersOf(e, now).find((h) => h.project !== null && h.project !== project);

  /** Every live engine, scanned rather than indexed by project: a second Map would be three places to forget, over a handful of engines. */
  const liveEngines = (now: number): EngineEntry[] =>
    [...engines.values()].filter((e) => now - e.seen < REGISTRY_TTL_MS);

  return {
    /** Record a heartbeat, pinning an id's token on first sight so a second process cannot hijack the entry; false on a mismatch. */
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
        holders: existing?.holders ?? new Map(),
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

    /** Take this engine, or renew a hold already taken — an OPEN and a RENEWAL, told apart by `secret`, under the three rules in docs/claim.md. */
    claim(id, req) {
      const e = get(id);
      // The engine itself is gone from the registry — nobody took anything from us.
      if (!e) return { ok: false, lost: "lapsed", heldBy: "" };
      const now = Date.now();
      holdersOf(e, now); // prune first, so what follows sees only live holders

      /** Is this holder, on this engine, the SAME instance we are asking about — one account on one machine being one session. */
      const sameInstance = (entry: EngineEntry, h: EngineHolder): boolean =>
        entry === e && h.holder === req.holder;

      if (req.secret !== undefined) {
        const mine = e.holders.get(req.secret);
        if (!mine) {
          // Gone, and the three ways that happens are three different things to be told, asked YOUR-project first — see docs/claim.md.
          const onMyProject = req.project
            ? liveEngines(now)
                .flatMap((x) => holdersOf(x, now).map((h) => ({ x, h })))
                .find(
                  ({ x, h }) =>
                    h.project === req.project && !sameInstance(x, h),
                )?.h
            : undefined;
          if (onMyProject)
            return { ok: false, lost: "project", heldBy: onMyProject.holder };
          // Nobody has our project but a DIFFERENT one has our engine; asked only if we HAD a project, a null holder never being displaced.
          const sitting = req.project
            ? otherProjectOn(e, req.project, now)
            : undefined;
          if (sitting)
            return {
              ok: false,
              lost: "engine",
              heldBy: sitting.holder,
              tookFor: sitting.project,
            };
          // Neither. The claim aged out with nobody to replace it — a sleep, a network gap.
          return { ok: false, lost: "lapsed", heldBy: "" };
        }
        mine.seen = now;
        mine.project = req.project;
        return { ok: true, secret: req.secret };
      }

      // An open.
      let tookOver: { holder: string; project: string | null } | undefined;
      const displace = (entry: EngineEntry, h: EngineHolder) => {
        for (const [secret, other] of entry.holders)
          if (other === h) entry.holders.delete(secret);
        tookOver = { holder: h.holder, project: h.project };
      };

      if (req.project !== null) {
        // Rule 1: the same project wherever it is open, except our own other screen on this very engine.
        for (const other of liveEngines(now))
          for (const h of holdersOf(other, now))
            if (h.project === req.project && !sameInstance(other, h))
              displace(other, h);
        // Rule 2: a DIFFERENT project already on this engine.
        const sitting = otherProjectOn(e, req.project, now);
        if (sitting) displace(e, sitting);
      }

      const secret = randomBytes(18).toString("hex");
      e.holders.set(secret, {
        project: req.project,
        holder: req.holder,
        seen: now,
      });
      return { ok: true, secret, tookOver };
    },

    /** Let go, carrying the SECRET rather than the engine token, so a goodbye drops only the hold it actually has. */
    release(id, secret) {
      get(id)?.holders.delete(secret);
    },

    engineForProject(project) {
      const now = Date.now();
      for (const e of liveEngines(now))
        if (holdersOf(e, now).some((h) => h.project === project)) return e.id;
      return undefined;
    },

    /** The browser-facing list: live engines, token stripped, tagged with a LAN hint. */
    list(requesterIp) {
      const now = Date.now();
      return live().map((e) => {
        const holders = holdersOf(e, now);
        // Whoever has a PROJECT on it is the interesting one to name; a null holder is pl8 looking at its catalogue.
        const owner = holders.find((h) => h.project !== null) ?? holders[0];
        return {
          id: e.id,
          hostname: e.hostname,
          addresses: e.addresses,
          assigned: holders.length > 0,
          // Who and what, so a picker can say "busy with X's winter.st0" rather than just "busy".
          heldBy: owner?.holder,
          heldProject: owner?.project ?? undefined,
          sameSourceIp:
            !!requesterIp && !!e.publicIpHint && e.publicIpHint === requesterIp,
        };
      });
    },
  };
}
