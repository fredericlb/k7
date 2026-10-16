// registry.ts — the in-memory engine registry, so a hosted web UI can list what's
// available, and the CLAIMS that say which project an engine is driving and for whom.
// Engines announce themselves with a periodic heartbeat and drop out after REGISTRY_TTL_MS of
// silence. An id is bound to the first TUNNEL SECRET it registered with (bindings.ts); the token
// is NOT a secret from the browser, and proves nothing on its own — docs/token.md.
// The claim's rules — one project per engine and session, one engine per project, newcomer wins — and why
// they are three rules and not one, are in docs/claim.md.

import { randomBytes } from "node:crypto";
import {
  ENGINE_ASSIGN_TTL_MS,
  type EngineAddresses,
  type PublicEngine,
} from "@studio/web-protocol";
import type { EnginePerformance } from "@studio/web-protocol/performance";
import { claimSlot } from "@studio/web-protocol/projects";
import { createBindings, type SecretBindings } from "./bindings.ts";

/** No heartbeat for this long ⇒ the engine is presumed gone. (Beats every ~5s.) */
export const REGISTRY_TTL_MS = 15000;
/** At most this many engines listed at once: the heartbeat is open, so the list must not be. */
export const MAX_ENGINES = 1000;
/** At most this many ids NEW to the list from one source address in a minute. */
export const NEW_IDS_PER_IP_PER_MINUTE = 30;

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
  performance?: EnginePerformance;
  /** The library level its machine runs — absent from an older supervisor. */
  libraryLevel?: number;
  publicIpHint?: string; // the source IP the heartbeat arrived from
  /** Its supervisor sends no tunnel secret: listed and tunnelled on its token alone — docs/token.md. */
  legacy: boolean;
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
  performance?: EnginePerformance;
  libraryLevel?: number;
  publicIpHint?: string;
  /** The supervisor's tunnel secret; absent from a supervisor older than it. Never stored, only its digest. */
  tunnelSecret?: string;
}

/** Why a heartbeat was refused: `token` — another token holds the id; `secret` — the id is bound to another secret; `full`/`rate` — admission. */
export type UpsertResult =
  | { ok: true }
  | { ok: false; why: "token" | "secret" | "full" | "rate" };

export interface RegistryOptions {
  /** Where the id → secret bindings live; in memory alone when absent. */
  bindings?: SecretBindings;
  maxEngines?: number;
  newIdsPerIpPerMinute?: number;
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
  upsert(input: HeartbeatInput): UpsertResult;
  get(id: string): EngineEntry | undefined;
  verifyToken(id: string, token: string): boolean;
  /** Whether a TUNNEL for `id` may open: its token, and its secret when the id is bound to one. */
  verifyTunnel(id: string, token: string, secret: string | undefined): boolean;
  /** Deregister; a bound id needs its secret too, so the token alone cannot unlist it. */
  remove(id: string, token: string, secret?: string): boolean;
  claim(id: string, req: ClaimRequest): ClaimResult;
  release(id: string, secret: string): void;
  /** Whether account `holder` holds a live claim on engine `id` — what lets a server route reach that engine for it. */
  holds(id: string, holder: string): boolean;
  /** Which engine is driving this project right now, or undefined. */
  engineForProject(project: string): string | undefined;
  /** The browser's list; `viewer` is the asking account, the only one whose claims it names. */
  list(requesterIp?: string, viewer?: string): PublicEngine[];
}

/** A registry instance — a FACTORY rather than a module-level Map, since module state in a shared package is one instance per importer. */
export function createRegistry(opts: RegistryOptions = {}): EngineRegistry {
  const engines = new Map<string, EngineEntry>();
  const bindings = opts.bindings ?? createBindings();
  const maxEngines = opts.maxEngines ?? MAX_ENGINES;
  const perIp = opts.newIdsPerIpPerMinute ?? NEW_IDS_PER_IP_PER_MINUTE;
  /** New ids per source address in the current minute. */
  const arrivals = new Map<string, { since: number; n: number }>();

  /** Whether `ip` may add one more id now; counts it when so. */
  const admit = (ip: string | undefined, now: number): boolean => {
    const key = ip ?? "?";
    let a = arrivals.get(key);
    if (!a || now - a.since >= 60_000) {
      // Pruned whole when it grows: a minute-old window is worth nothing.
      if (arrivals.size > 10_000) arrivals.clear();
      a = { since: now, n: 0 };
      arrivals.set(key, a);
    }
    if (a.n >= perIp) return false;
    a.n++;
    return true;
  };

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

  /** A holder on this engine whose project is not this one and would share its session; at most one, by rule 2 — see docs/claim.md. */
  const otherProjectOn = (
    e: EngineEntry,
    project: string,
    holder: string,
    now = Date.now(),
  ): EngineHolder | undefined =>
    holdersOf(e, now).find(
      (h) =>
        h.project !== null &&
        h.project !== project &&
        // The same account in ANOTHER of its sessions is not in the way: its bench beside its song.
        !(h.holder === holder && claimSlot(h.project) !== claimSlot(project)),
    );

  /** Every live engine, scanned rather than indexed by project: a second Map would be three places to forget, over a handful of engines. */
  const liveEngines = (now: number): EngineEntry[] =>
    [...engines.values()].filter((e) => now - e.seen < REGISTRY_TTL_MS);

  return {
    /** Record a heartbeat under the bindings' rule, pinning an unbound id's token on first sight — docs/token.md. */
    upsert(input) {
      const existing = get(input.id);
      const now = Date.now();
      const verdict = bindings.check(input.id, input.tunnelSecret);
      if (verdict === "refused") return { ok: false, why: "secret" };
      // The secret proves the machine, so its token may change; without one, the token first seen holds the id.
      if (verdict !== "bound" && existing && existing.token !== input.token)
        return { ok: false, why: "token" };
      if (!existing) {
        if (live().length >= maxEngines) return { ok: false, why: "full" };
        if (!admit(input.publicIpHint, now)) return { ok: false, why: "rate" };
      }
      if (input.tunnelSecret) bindings.bind(input.id, input.tunnelSecret);
      engines.set(input.id, {
        id: input.id,
        token: input.token,
        hostname: input.hostname,
        machineFingerprint: input.machineFingerprint,
        addresses: input.addresses,
        performance: input.performance,
        libraryLevel: input.libraryLevel,
        publicIpHint: input.publicIpHint,
        legacy: !input.tunnelSecret,
        holders: existing?.holders ?? new Map(),
        seen: now,
      });
      return { ok: true };
    },

    get,

    /** The anti-spoof gate: does this id exist and match this token? */
    verifyToken(id, token) {
      const e = get(id);
      return !!e && e.token === token;
    },

    verifyTunnel(id, token, secret) {
      const e = get(id);
      if (!e || e.token !== token) return false;
      // A bound id takes its own secret only; an unbound one is a legacy supervisor's, on its token.
      return bindings.check(id, secret || undefined) !== "refused";
    },

    remove(id, token, secret) {
      const e = engines.get(id);
      if (!e) return true; // already gone — deregister is idempotent
      if (e.token !== token) return false;
      if (bindings.check(id, secret || undefined) === "refused") return false;
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
            ? otherProjectOn(e, req.project, req.holder, now)
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
        const sitting = otherProjectOn(e, req.project, req.holder, now);
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

    holds(id, holder) {
      const e = get(id);
      return !!e && !!holder && holdersOf(e).some((h) => h.holder === holder);
    },

    engineForProject(project) {
      const now = Date.now();
      for (const e of liveEngines(now))
        if (holdersOf(e, now).some((h) => h.project === project)) return e.id;
      return undefined;
    },

    /** The browser-facing list: live engines, token stripped, tagged with a LAN hint; another account's claims read as "in use" alone. */
    list(requesterIp, viewer) {
      const now = Date.now();
      return live().map((e) => {
        const holders = holdersOf(e, now);
        // Whoever has a PROJECT on it is the interesting one to name — a song before a bench; a null holder is pl8 looking at its catalogue.
        const claimed = holders.filter((h) => h.project !== null);
        const mine = (h: EngineHolder) => !!viewer && h.holder === viewer;
        const first =
          claimed.find((h) => claimSlot(h.project ?? "") === "project") ??
          claimed[0] ??
          holders[0];
        const owner = first && mine(first) ? first : undefined;
        return {
          id: e.id,
          hostname: e.hostname,
          addresses: e.addresses,
          performance: e.performance,
          ...(e.libraryLevel ? { libraryLevel: e.libraryLevel } : {}),
          assigned: holders.length > 0,
          // Who and what, named to that account alone: anyone else reads "in use" and learns no email.
          heldBy: owner?.holder,
          heldProject: owner?.project ?? undefined,
          heldProjects: claimed.filter(mine).map((h) => ({
            holder: h.holder,
            project: h.project ?? "",
          })),
          ...(e.legacy ? { legacy: true } : {}),
          sameSourceIp:
            !!requesterIp && !!e.publicIpHint && e.publicIpHint === requesterIp,
        };
      });
    },
  };
}
