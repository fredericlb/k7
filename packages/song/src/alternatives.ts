// alternatives.ts — what a module looks like once its selected alternative is applied. Which
// ones it HAS and which is on are @studio/song-schema's: pure struct work a browser may ask.
// Applying one is here, because it is the same merge a node gets over the module it extends.
// Full rationale: docs/alternatives.md.

import { currentAlternative } from "@studio/song-schema/alternatives";
import { mergeAuthored } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

/** `m` with its selected alternative merged over its own fields, `name` dropped — docs/alternatives.md. */
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
