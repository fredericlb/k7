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

/**
 * One tab holding one engine.
 *
 * `secret` is what makes takeover work rather than ping-pong. Every renewal carries it; a
 * renewal whose secret is no longer registered is REFUSED instead of granted, which is how a
 * displaced tab finds out it lost the project. Without it, "the newcomer wins" would mean the
 * loser wins it straight back on its next five-second tick, for ever.
 */
export interface EngineHolder {
  /**
   * The launch address — `<repo>/<projet>` — or **null** for a surface that opens on no project.
   *
   * The null case is not a detail. pl8 drives an engine without ever opening a project: it
   * auditions modules and plays songs out of the médiathèque. A null holder conflicts with
   * nothing and nothing conflicts with it, so looking at the catalogue cannot take a song away
   * from the st0 tab beside it.
   */
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
  // Live holders by their secret. Expires on its own, because a holder is a browser tab: it can
  // only say goodbye best-effort, so "in use" must not depend on a goodbye arriving.
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
  /**
   * The caller renewed a claim that is no longer theirs. There is no retry — the holder lets
   * go and says so.
   *
   * WHY it went is part of the answer, because the three read completely differently to the
   * person looking at the screen and only one of them is "your project is open elsewhere".
   * They were one `heldBy` for a while, and a tab displaced by a DIFFERENT project was told
   * its own had been reopened — which was not true, and left nothing to act on.
   */
  | {
      ok: false;
      /**
       * `project` — somebody ELSE opened the same project, or we did on another machine.
       * `engine`  — another project took this engine. `tookFor` names it.
       * `lapsed`  — nobody took anything; this claim simply aged out (a sleep, a gap).
       */
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

/**
 * A registry instance.
 *
 * A FACTORY rather than the module-level Map this was as st0' own file. One process still
 * holds exactly one, so nothing behaves differently today — but module state in a shared
 * package is one instance for every importer that ever appears, and this file now has two
 * services and a test suite ahead of it.
 */
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

  /**
   * A holder on this engine that has a project OTHER than this one, if any.
   *
   * At most one, by construction — that is rule 2, and it is what this predicate is for. It used
   * to be "any holder with a project", which read the same because rule 1 had always cleared the
   * matching ones first. It no longer does: one account's several screens on one engine share a
   * session and coexist on one project, so the difference has to be spelled out.
   */
  const otherProjectOn = (
    e: EngineEntry,
    project: string,
    now = Date.now(),
  ): EngineHolder | undefined =>
    holdersOf(e, now).find((h) => h.project !== null && h.project !== project);

  /**
   * Every live engine, scanned rather than indexed by project.
   *
   * A second Map keyed by project would have to be kept in step with every expiry, every
   * takeover and every heartbeat that drops an engine — three places to forget. There are a
   * handful of engines, and this runs on a five-second tick.
   */
  const liveEngines = (now: number): EngineEntry[] =>
    [...engines.values()].filter((e) => now - e.seen < REGISTRY_TTL_MS);

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

    /**
     * Take this engine, for a project or for nothing, or renew a hold already taken.
     *
     * Two shapes, told apart by `secret`:
     *
     * - **no secret — an OPEN.** The newcomer always wins. Whoever held this project ELSEWHERE,
     *   and whoever held a *different* project on this engine, is displaced.
     * - **a secret — a RENEWAL.** Granted only while that secret is still registered. A renewal
     *   must never take over, or a displaced tab wins the project back five seconds later, for
     *   ever.
     *
     * Three rules, and each earns its place:
     *
     * 1. **One engine per project.** Two people on one project is what the whole change is for —
     *    two SESSIONS, which is why one account's several screens on one engine are exempt.
     * 2. **One project per engine.** Not tidiness: the file service on that machine holds a
     *    SINGLE active project (`engineLink.ts` — "several browser tabs share it, last write
     *    wins"), so a second project there does not coexist, it clobbers.
     * 3. **A null project conflicts with nothing.** pl8 drives an engine and opens no project;
     *    it must be able to sit beside the st0 tab on the same machine.
     */
    claim(id, req) {
      const e = get(id);
      // The engine itself is gone from the registry — nobody took anything from us.
      if (!e) return { ok: false, lost: "lapsed", heldBy: "" };
      const now = Date.now();
      holdersOf(e, now); // prune first, so what follows sees only live holders

      /**
       * Is this holder, on this engine, the SAME instance we are asking about?
       *
       * Same account and same machine means one engine session — `sessionFor(<service>, email)`,
       * one project loaded in it (packages/engine-protocol/docs/sessions.md). So the two are not
       * two drivers of one project: they are one driver with two screens, which is what an
       * external surface beside its editor is, and what two tabs of one song have always been.
       * Rule 1 has nothing to protect there, and enforcing it evicted a person from their own
       * project the moment they opened a surface on a tablet.
       */
      const sameInstance = (entry: EngineEntry, h: EngineHolder): boolean =>
        entry === e && h.holder === req.holder;

      if (req.secret !== undefined) {
        const mine = e.holders.get(req.secret);
        if (!mine) {
          // Gone — and the three ways that happens are three different things to be told.
          // Asked in this order because the first is the one that is about YOUR project.
          //
          // Our own other screen is not an answer to any of them: it holds what we hold and took
          // nothing, so a claim that lapsed beside it reads as `lapsed` — which the hold loop
          // retries, and which the exemption below then grants without displacing it.
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
          // Nobody has our project, but somebody has our engine: a DIFFERENT project took it.
          // Only if we HAD a project: a project-less holder is never displaced (the rules below
          // leave it alone), so it can only have lapsed — however busy the engine looks now.
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
        // Rule 1: the same project, wherever it is open — but not our own other screen on this
        // very engine, which is the same session driving the same loaded project. See above.
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

    /**
     * Let go. Carries the SECRET, not the engine token: a goodbye may only drop the hold it
     * actually has, or a tab leaving would drop whoever took the project from it a moment ago.
     * Silent either way — this arrives by sendBeacon from a page already gone.
     */
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
        // Whoever has a PROJECT on it is the interesting one to name — a null holder is pl8
        // looking at its catalogue, which nobody needs to be warned about.
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
