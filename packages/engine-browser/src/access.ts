// access.ts — one object per app for everything a browser does to reach an engine: the
// registry's five routes, the probe, the choice and the lease. The pieces below it already
// existed; what this adds is that `base` is given ONCE. See docs/access.md.

import { chooseEngine } from "./choose.ts";
import { type HoldOptions, holdEngine } from "./lease.ts";
import { type ProbeTarget, probeEngines, type RankedEngine } from "./probe.ts";
import {
  type EnginePrefs,
  type ReadJson,
  type RegistryClient,
  registryClient,
} from "./registry.ts";

/** What one look at the registry produced: the measured list, and what to do with it. */
export interface EngineLookup<E extends ProbeTarget> {
  /** Every engine this service knows, MEASURED — the unreachable sink to the bottom. */
  ranked: RankedEngine<E>[];
  /** The id the account remembers, whether or not it answered. */
  rememberedId: string | undefined;
  /** The one to drive, or null when there is a question to ask (or nothing to ask about). */
  chosen: RankedEngine<E> | null;
  /** Several answered and none was remembered — the only case worth a picker. */
  ambiguous: boolean;
}

export interface EngineAccess<
  E extends ProbeTarget,
  P extends EnginePrefs = EnginePrefs,
> extends RegistryClient<E, P> {
  /** Measure every engine in the list, through this service's relay when the direct link is
   *  refused. Curried on `base`, which is the whole point of this file. */
  probe(engines: E[]): Promise<RankedEngine<E>[]>;
  /**
   * List, read the preference, measure, and apply the policy — the four steps every gate runs
   * in this order.
   *
   * `preferId` wins over the stored preference: it is the same value, but it arrives already
   * updated when someone changes it from a picker beside the screen, whereas the fetch would
   * still answer with what was saved a moment ago.
   *
   * A registry that does not answer reads as NO ENGINE, not as an error. That is the honest
   * state — a service whose registry is down genuinely cannot be driven right now — and it is
   * a screen, where a rejected promise inside a gate's effect is an eternal spinner.
   */
  find(preferId?: string): Promise<EngineLookup<E>>;
  /**
   * Claim a measured engine for a project and keep it. Returns the goodbye, for unmount.
   *
   * `opts.project` is what makes "one engine per project" true: opening a project somebody else
   * has open takes it from them, and their `onLost` fires. A surface that opens on no project at
   * all — pl8 — passes null and never competes for one.
   */
  hold(chosen: RankedEngine<E>, opts?: HoldOptions): () => void;
  /**
   * Where to reach ONE engine, asked again — what `EngineClient` calls before reconnecting.
   *
   * Not the address kept from the first measurement, and that is the point twice over. The
   * relayed URL carries a ticket good for a minute, so the old one is refused outright after
   * that; and the best route may simply have moved — a laptop carried onto the engine's own
   * network stops needing the relay. Null when that engine is no longer listed or no longer
   * answers, which the client reads as "not now" rather than as a failure.
   */
  wsUrlFor(id: string): Promise<string | null>;
  /**
   * What to hand `new EngineClient(...)`: the address just measured, then a fresh one.
   *
   * The first connection has no reason to measure again — the gate did it a moment ago, and
   * `wsUrlFor` costs a registry round trip plus a probe. Every connection AFTER it has every
   * reason to, because the ticket in that first URL has a minute to live. One function so the
   * three surfaces cannot each get half of it right.
   */
  linkUrl(chosen: RankedEngine<E>): () => string | Promise<string | null>;
}

/**
 * Everything one service's browser needs, bound to that service's origin prefix.
 *
 * `base` is the app's own prefix — "" for l8, "/pl8", "/m9". It used to be passed separately
 * to `registryClient(base, …)` and to `probeEngines(list, base)`, which is one fact written
 * twice: an app could hold the registry client and still measure without the relay, and for
 * months every app did, because `probeEngines` had no second argument to forget yet. Once it
 * is a constructor argument there is nothing left to keep in step.
 */
export function engineAccess<
  E extends ProbeTarget,
  P extends EnginePrefs = EnginePrefs,
>(base: string, json: ReadJson): EngineAccess<E, P> {
  const reg = registryClient<E, P>(base, json);
  const probe = (engines: E[]) => probeEngines(engines, base);

  return {
    ...reg,
    probe,
    async find(preferId) {
      // Both at once: a remembered id is only a hint that still has to be probed, so waiting
      // for one before starting the other would add a round trip to every load.
      const [list, prefs] = await Promise.all([
        reg.list().catch(() => [] as E[]),
        reg.prefs().catch(() => ({}) as P),
      ]);
      const ranked = await probe(list);
      const rememberedId = preferId ?? prefs.engineId;
      const { engine, ambiguous } = chooseEngine(ranked, rememberedId);
      return { ranked, rememberedId, chosen: engine, ambiguous };
    },
    hold: (chosen, opts) =>
      holdEngine(
        reg,
        chosen.engine.id,
        chosen.token ?? "",
        chosen.latency?.totalMs ?? 0,
        opts ?? { project: null },
      ),
    linkUrl(chosen) {
      let measured: string | null = chosen.wsUrl;
      return () => {
        const first = measured;
        measured = null; // spent: from here on, ask for a live one
        return first ?? this.wsUrlFor(chosen.engine.id);
      };
    },
    async wsUrlFor(id) {
      // Through the registry rather than from a cache: the ticket is minted by that call, so
      // there is no fresh URL to be had without it.
      const list = await reg.list().catch(() => [] as E[]);
      const engine = list.find((e) => e.id === id);
      if (!engine) return null;
      const [ranked] = await probe([engine]);
      return ranked?.wsUrl ?? null;
    },
  };
}
