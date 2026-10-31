// choose.ts — which engine a service should drive, given what the account remembers. The
// policy alone, with no React and no fetching: the account's choice first, an obvious
// answer second, and the picker only when there IS a question.
//
// The one thing a reader would get wrong: anyone may register an engine, so only a TRUSTED
// engine (`mayAutoPick`) is ever taken without a click — docs/access.md, "Who is taken unasked".

import {
  onThisMachine,
  type ProbeTarget,
  type RankedEngine,
  reachedDirectly,
} from "./probe.ts";

export interface Choice<E extends ProbeTarget> {
  /** The engine to use, or null when the user has to be asked (or there is none). */
  engine: RankedEngine<E> | null;
  /** True when several were reachable and none was remembered — a single reachable engine is not a choice, it is the answer. */
  ambiguous: boolean;
}

/** Whether this engine may be taken with nobody clicking: the account's own pick, one reached directly, or the server's own. */
export function mayAutoPick<E extends ProbeTarget>(
  r: RankedEngine<E>,
  remembered: string | undefined,
): boolean {
  // Through another server, its files are that server's: only a person's own pick moves the project there.
  if (r.engine.via)
    return remembered !== undefined && r.engine.id === remembered;
  return (
    (remembered !== undefined && r.engine.id === remembered) ||
    reachedDirectly(r) ||
    r.engine.server === true
  );
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

  // One reachable engine is the answer only when it may be taken unasked; a stranger's engine is a question.
  const only = reachable.length === 1 ? reachable[0] : undefined;
  if (only && mayAutoPick(only, rememberedId))
    return { engine: only, ambiguous: false };

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
  /** The engine this account last CHOSE — a person's pick, which a faster machine elsewhere does not overrule. */
  remembered?: string;
}

/**
 * The engine to take when nobody has to be asked: COMPATIBILITY with the project first — an engine
 * missing a plugin plays the song wrong — then the engine this account last CHOSE, then the one on
 * THIS machine (its sound comes out where you sit), then the latency class, the machine's
 * performance and the latency in ms. Only a TRUSTED engine (`mayAutoPick`) that is reachable, with
 * a token, and not in use is a candidate. Null when there is none. See docs/access.md.
 */
export function bestEngine<E extends RatedTarget>(
  ranked: RankedEngine<E>[],
  opts: BestEngineOptions = {},
): RankedEngine<E> | null {
  const compat = (r: RankedEngine<E>): number =>
    opts.compat?.(r.engine.id) ?? -1;
  const candidates = ranked.flatMap((r) =>
    r.latency &&
    r.wsUrl &&
    r.token &&
    !r.engine.assigned &&
    mayAutoPick(r, opts.remembered)
      ? [{ r, latency: r.latency }]
      : [],
  );
  // 1 for what should come first, so `b - a` sorts it there.
  const isRemembered = (r: RankedEngine<E>): number =>
    opts.remembered !== undefined && r.engine.id === opts.remembered ? 1 : 0;
  const here = (r: RankedEngine<E>): number => (onThisMachine(r) ? 1 : 0);
  candidates.sort(
    (a, b) =>
      compat(b.r) - compat(a.r) ||
      isRemembered(b.r) - isRemembered(a.r) ||
      here(b.r) - here(a.r) ||
      a.latency.quality.localeCompare(b.latency.quality) ||
      (b.r.engine.performance?.score ?? 0) -
        (a.r.engine.performance?.score ?? 0) ||
      a.latency.totalMs - b.latency.totalMs,
  );
  return candidates[0]?.r ?? null;
}
