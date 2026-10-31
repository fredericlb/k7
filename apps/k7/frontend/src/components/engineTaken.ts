// engineTaken.ts — what the gate decides about its claim: when to hold it, and what the banner says
// once somebody else took it. Pure, so the order and the wording's choice are tested without React.
// See ../../docs/shell.md, "When somebody else takes the engine".

import type { ClaimTakenReason } from "@studio/engine-browser/lease";

/** Somebody took the claim: who, why, and for `engine` the project that took the machine. */
export interface Taken {
  heldBy: string;
  why: ClaimTakenReason;
  tookFor: string | null;
}

/** Which sentence the banner says, and which "take it back" it offers — none for an engine that is not ours. */
export interface TakenBanner {
  says: "engine" | "project" | "projectAnon" | "refused";
  takeBack: "engine" | "project" | null;
}

export function takenBanner(t: Taken): TakenBanner {
  if (t.why === "engine") return { says: "engine", takeBack: "engine" };
  // Asking again would be refused again: the only way on is another engine.
  if (t.why === "refused") return { says: "refused", takeBack: null };
  return { says: t.heldBy ? "project" : "projectAnon", takeBack: "project" };
}

/** Hold the claim only with an engine, a project the address resolved to, a tab awake, and nobody else's claim standing. */
export function holdsClaim(s: {
  engine: boolean;
  resolved: boolean;
  asleep: boolean;
  taken: boolean;
}): boolean {
  return s.engine && s.resolved && !s.asleep && !s.taken;
}
