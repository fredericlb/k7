// alternatives.ts — what a module looks like once its selected alternative is applied. Which
// ones it HAS and which is on are @studio/song-schema's: pure struct work a browser may ask.
// Applying one is here, because it is the same merge a node gets over the module it extends.
// Full rationale: docs/alternatives.md.

import { currentAlternative } from "@studio/song-schema/alternatives";
import { mergeAuthored } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

/** The selected set's own fields, or null when the module's own are on — `name` never among them. */
function chosenSet(m: LoadedModule): Record<string, unknown> | null {
  const at = currentAlternative(m);
  if (at === 0) return null;
  const list = (m.alternatives ?? []) as Record<string, unknown>[];
  const chosen = list[at - 1];
  if (!chosen) return null;
  const { name: _dropped, ...fields } = chosen;
  return fields;
}

/** `m` with its selected alternative merged over its own fields — a PATCH, its `extends` ignored (docs/alternatives.md). */
export function applyAlternative<T extends LoadedModule>(m: T): T {
  const fields = chosenSet(m);
  if (!fields) return m;
  // A set naming another module is `swappedModule`'s; where that is refused, what is left of it is a patch.
  const { extends: _other, ...patch } = fields;
  return mergeAuthored(
    m as unknown as Record<string, unknown>,
    patch,
  ) as unknown as T;
}

/** The node as ANOTHER module, when its selected set names one: its identity kept, set "1"'s fields not. */
export function swappedModule<T extends LoadedModule>(m: T): T | null {
  const fields = chosenSet(m);
  if (typeof fields?.extends !== "string" || !fields.extends) return null;
  // What makes it THIS node — its name, its file, its folder — and what it could be switched to instead.
  const { name, node, file, home, folderAbs, alternatives, alternative } = m;
  const { presetRel, chain, nodeId } = m;
  return {
    name,
    node,
    file,
    home,
    ...(presetRel ? { presetRel } : {}),
    ...(chain ? { chain } : {}),
    ...(nodeId ? { nodeId } : {}),
    folderAbs,
    alternatives,
    alternative,
    ...fields,
  } as T;
}
