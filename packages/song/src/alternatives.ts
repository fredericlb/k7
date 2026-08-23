// alternatives.ts — what a module looks like once its selected alternative is applied. Which
// ones it HAS and which is on are @studio/song-schema's: pure struct work a browser may ask.
// Applying one is here, because it is the same merge a node gets over the module it extends.
// Full rationale: docs/alternatives.md.

import { currentAlternative } from "@studio/song-schema/alternatives";
import { mergeAuthored } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

/**
 * `m` with its selected alternative merged over its own fields.
 *
 * The SAME merge a node gets over the module it extends (`mergeAuthored`), and that is the
 * whole of what an alternative is: an ordinary extender of its own module. So `params` merge per
 * entry — an alternative that sets `Gain` leaves `Tone` alone — while a LIST is a scalar to the
 * merge, so an alternative restating `events:` replaces the arrangement outright. Both readings
 * are the ones already true everywhere else here.
 *
 * The alternative's `name` is dropped before merging. It is in `OWN_ONLY`, so leaving it in would
 * rename the module to the name of its variant — and a module's name is the key a chain calls it
 * by, which is not a thing a setting may change.
 *
 * `alternatives`/`alternative` ride through untouched, so a surface can still list them AFTER
 * resolution: what is drawn on the node is what the file says, not what it was collapsed to.
 */
export function applyAlternative<T extends LoadedModule>(m: T): T {
  const at = currentAlternative(m);
  if (at === 0) return m;
  const list = (m.alternatives ?? []) as Record<string, unknown>[];
  const chosen = list[at - 1];
  if (!chosen) return m;
  const { name: _dropped, ...fields } = chosen;
  return mergeAuthored(
    m as unknown as Record<string, unknown>,
    fields,
  ) as unknown as T;
}
