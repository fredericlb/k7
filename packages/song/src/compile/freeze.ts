// compile/freeze.ts — the frozen points of a compile: a `frozen:` module, or an automatic
// freeze, stands in for everything upstream of it, and its render plays on the track its
// chain compiles onto. What a reader gets wrong: a render id carries a RESERVED suffix.
// Part of nodeProject.ts's compile — docs/freeze.md.

import { resolve } from "node:path";
import { confineTo } from "../confine";
import { activeFreezePlans } from "../freeze";
import type { ClipDoc } from "../project";
import { wsExists } from "../yaml/workspaceFile";
import type { CompileInputs } from "./inputs";
import type { ChainOwnership } from "./ownership";

// What a render's clip id ends with — a RESERVED suffix, because the compiled doc has no other way to say it (docs/freeze.md).
export const FROZEN_CLIP_SUFFIX = "__frozen";
export const isFrozenClipId = (id: string): boolean =>
  id.endsWith(FROZEN_CLIP_SUFFIX);

// The one clip a frozen track plays; `length: 0` tells the engine to use the file's natural length (docs/freeze.md).
export function frozenClip(id: string, source: string): ClipDoc {
  return {
    id: `${id}${FROZEN_CLIP_SUFFIX}`,
    type: "audio",
    name: `${id} (frozen)`,
    source,
    start: 0,
    length: 0,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
  };
}

/** The frozen points in force: what they silence, and which track plays each render — docs/freeze.md. */
export function freezePoints(
  dir: string,
  inp: CompileInputs,
  own: ChainOwnership,
  /** Automatic freezes in force, module → render: frozen exactly as a `frozen:` field would be. */
  autoFrozen: Record<string, string>,
): {
  frozenLanes: Set<string>;
  frozenPlugins: Set<string>;
  renderOn: Map<string, string>;
} {
  const { chains, lanesMap, modulesMap, roots } = inp;
  const { ownerOf } = own;
  // …and an AUTOMATIC one (docs/autoFreeze.md) is the same field, set here rather than in a file.
  const withAutoFrozen = Object.keys(autoFrozen).length
    ? {
        ...modulesMap,
        ...Object.fromEntries(
          Object.entries(autoFrozen).map(([m, render]) => [
            m,
            { ...modulesMap[m], frozen: render },
          ]),
        ),
      }
    : modulesMap;
  const plans = activeFreezePlans(
    chains,
    withAutoFrozen,
    (n) => n in lanesMap,
    (r) => {
      const at = confineTo(roots, resolve(dir, r));
      return !!at && wsExists(at);
    },
  );
  const frozenLanes = new Set(plans.flatMap((p) => [...p.lanes]));
  const frozenPlugins = new Set(plans.flatMap((p) => [...p.modules]));
  // Which track plays each render: the one the frozen module's own chain compiles onto, whichever shape it is.
  const renderOn = new Map<string, string>();
  for (const p of plans)
    for (const [name, c] of Object.entries(chains))
      if (c.use.some((s) => s.module === p.at)) {
        const owner = ownerOf(name, c);
        const at = confineTo(roots, resolve(dir, p.render));
        if (owner && at) renderOn.set(owner, at);
      }
  return { frozenLanes, frozenPlugins, renderOn };
}
