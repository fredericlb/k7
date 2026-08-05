// access.ts — one object per app for everything a browser does to reach an engine: the
// registry's five routes, the probe, the choice and the lease. The pieces below it already
// existed; what this adds is that `base` is given ONCE. See docs/access.md.

import { chooseEngine } from "./choose.ts";
import { holdEngine } from "./lease.ts";
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
  /** Take the lease on a measured engine and keep it. Returns the goodbye, for unmount. */
  hold(chosen: RankedEngine<E>): () => void;
}

/**
 * Everything one service's browser needs, bound to that service's origin prefix.
 *
 * `base` is the app's own prefix — "" for st0, "/l8", "/m9". It used to be passed separately
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
    hold: (chosen) =>
      holdEngine(
        reg,
        chosen.engine.id,
        chosen.token ?? "",
        chosen.latency?.totalMs ?? 0,
      ),
  };
}
