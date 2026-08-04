// choose.ts — which engine a service should drive, given what the account remembers. The
// policy alone, with no React and no fetching: the account's choice first, an obvious
// answer second, and the picker only when there IS a question.
//
// Shared because it is the same question in every service — it was written for the
// médiathèque's module preview and m9 wanted it verbatim the same day.

import type { PublicEngine } from "@studio/web-protocol";
import type { RankedEngine } from "./probe.ts";

export interface Choice {
  /** The engine to use, or null when the user has to be asked (or there is none). */
  engine: RankedEngine<PublicEngine> | null;
  /** True when several were reachable and none was remembered — the only case worth a
   *  question. A single reachable engine is not a choice, it is the answer. */
  ambiguous: boolean;
}

/**
 * Pick from what the registry offered, given what this account remembers.
 *
 * UNREACHABLE means "listed but nothing answered from this browser": the engine is on a
 * network we are not on. Those are excluded everywhere here — offering one produces a preview
 * that silently never connects, which reads as a broken editor rather than a wrong network.
 * It is the one state that is not a latency, which is why it survived the tiers.
 *
 * A remembered engine that is unreachable does NOT clear the preference. The usual reason
 * is being on the wrong network or the machine being off, and forgetting the choice would
 * mean re-picking every time you work from somewhere else.
 */
export function chooseEngine(
  ranked: RankedEngine<PublicEngine>[],
  rememberedId: string | undefined,
): Choice {
  const reachable = ranked.filter((r) => r.wsUrl && r.token);

  const remembered = rememberedId
    ? reachable.find((r) => r.engine.id === rememberedId)
    : undefined;
  if (remembered) return { engine: remembered, ambiguous: false };

  // Nothing remembered, or it is not here. One reachable engine is not a question — asking
  // would put a dialog in front of the only possible answer.
  if (reachable.length === 1) return { engine: reachable[0], ambiguous: false };

  return { engine: null, ambiguous: reachable.length > 1 };
}
