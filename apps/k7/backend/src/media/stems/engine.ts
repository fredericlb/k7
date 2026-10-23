// engine.ts — which engine a stems cut runs on, and whether the caller may hand it the song. A cut shares the
// song and the account's models with that machine, so it goes to the account's own engines, the server's, or
// one the caller is driving — never to someone else's merely shared with it. See ../../../docs/media/stems.md.

import { type EngineMount, engineRole } from "@studio/engine-registry";

/** Whether `holder` may cut on engine `id`: theirs, the server's, or one their session holds a claim on. */
export function mayCut(
  engines: EngineMount,
  id: string,
  holder: string,
): boolean {
  if (engines.tunnels.isRenderer(id)) return true;
  if (holder && engines.registry.holds(id, holder)) return true;
  return engineRole(engines.registry, id, holder, false) === "owner";
}

/** The best-rated engine `holder` may cut on that a jobs channel can reach, or null when none is online. */
export function bestCutter(
  engines: EngineMount,
  holder: string,
): string | null {
  const ranked = engines.registry
    .list(undefined, holder)
    .filter((e) => engines.tunnels.has(e.id) && mayCut(engines, e.id, holder))
    // An engine that could not rate its machine counts last, not as broken.
    .sort((a, b) => (b.performance?.score ?? 0) - (a.performance?.score ?? 0));
  return ranked[0]?.id ?? null;
}
