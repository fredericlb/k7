// choose.ts — which engine a service should drive, given what the account remembers. The
// policy alone, with no React and no fetching: the account's choice first, an obvious
// answer second, and the picker only when there IS a question.
//
// Shared because it is the same question in every service — st0's gate and the médiathèque's
// module preview want it verbatim.

import type { ProbeTarget, RankedEngine } from "./probe.ts";

export interface Choice<E extends ProbeTarget> {
  /** The engine to use, or null when the user has to be asked (or there is none). */
  engine: RankedEngine<E> | null;
  /** True when several were reachable and none was remembered — a single reachable engine is not a choice, it is the answer. */
  ambiguous: boolean;
}

/** Pick from what the registry offered: UNREACHABLE engines are excluded, and a remembered one being away does NOT clear the preference. */
export function chooseEngine<E extends ProbeTarget>(
  ranked: RankedEngine<E>[],
  rememberedId: string | undefined,
): Choice<E> {
  const reachable = ranked.filter((r) => r.wsUrl && r.token);

  const remembered = rememberedId
    ? reachable.find((r) => r.engine.id === rememberedId)
    : undefined;
  if (remembered) return { engine: remembered, ambiguous: false };

  // Nothing remembered, or it is not here; one reachable engine is not a question, and asking would put a dialog in front of the only answer.
  if (reachable.length === 1) return { engine: reachable[0], ambiguous: false };

  return { engine: null, ambiguous: reachable.length > 1 };
}

/** What `bestEngine` reads beyond the probe: both optional, so an engine that reports neither still ranks on its latency. */
export interface RatedTarget extends ProbeTarget {
  assigned?: boolean;
  performance?: { score: number } | null;
}

/** What else `bestEngine` may weigh. */
export interface BestEngineOptions {
  /** The engine's compatibility with the project (0–100, see compat.ts); null when it could not be told, which ranks below any score. */
  compat?: (engineId: string) => number | null;
}

/**
 * The engine to take when nobody has to be asked, in three steps: COMPATIBILITY with the project
 * first — an engine missing a plugin plays the song wrong, however fast it is — then the LATENCY
 * CLASS (quality tier) — a machine you cannot play through is no use either — then the MACHINE's
 * performance score. The latency in ms only breaks a tie left after all three. Only what a picker
 * would let you pick is a candidate: reachable, with a token, and not in use. Null when there is
 * none.
 */
export function bestEngine<E extends RatedTarget>(
  ranked: RankedEngine<E>[],
  opts: BestEngineOptions = {},
): RankedEngine<E> | null {
  const compat = (r: RankedEngine<E>): number =>
    opts.compat?.(r.engine.id) ?? -1;
  const candidates = ranked.flatMap((r) =>
    r.latency && r.wsUrl && r.token && !r.engine.assigned
      ? [{ r, latency: r.latency }]
      : [],
  );
  candidates.sort(
    (a, b) =>
      compat(b.r) - compat(a.r) ||
      a.latency.quality.localeCompare(b.latency.quality) ||
      (b.r.engine.performance?.score ?? 0) -
        (a.r.engine.performance?.score ?? 0) ||
      a.latency.totalMs - b.latency.totalMs,
  );
  return candidates[0]?.r ?? null;
}
