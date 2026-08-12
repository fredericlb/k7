// mapping.ts — which controls a `turntables` surface must have wired before it can be drawn,
// and which of them a given `mapping` is missing. The desk's own vocabulary: @studio/song
// validates the SHAPE of a mapping and deliberately not its ids.
// See packages/song/docs/surfaces.md.

import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { MIX_CONTROLS, type MixControl } from "./controls";
import { DECKS } from "./deck";

/**
 * The controls that must name a module, per deck. NOT every control on the desk.
 *
 * The line is whether the control drives a module PARAM. These five do — the crossfade's `Mix`,
 * the three EQ bands, the filter, and the tempo (which reaches its module the other way, by the
 * track whose material it warps; see `stretchTargets`). `transport`, `sync` and `listen` are
 * actions of the application: play the set, align two beats, monitor in this tab. They name no
 * param, so requiring a mapping for them would print an error nobody can clear.
 */
const WIRED_PER_DECK = ["tempo", "eqLow", "eqMid", "eqHigh", "filter"] as const;

/**
 * Every control a turntables surface needs wired, derived from `DECKS` rather than listed.
 *
 * The same rule `MIX_CONTROLS` follows and for the same reason: a third deck is a third track
 * and a second meeting point in the chains file, and a hardcoded pair here would leave the new
 * deck's knobs silently unrequired — which reads as "already fine" rather than "not wired yet".
 */
export const REQUIRED_CONTROLS: readonly MixControl[] = MIX_CONTROLS.filter(
  (c) =>
    c.id === "crossfade" ||
    DECKS.some((d) =>
      WIRED_PER_DECK.some((suffix) => c.id === `${d}.${suffix}`),
    ),
);

/**
 * The required controls this mapping does not name — what the surface draws an error for.
 *
 * A component with no line in `mapping` is the case this answers. A line that IS there but
 * points at a module the chains do not have is a different failure, and a better-informed one:
 * `resolveBindings` catches it against the compiled graph and says which name was not found.
 * Keeping the two apart is what lets each say something true — "you have not wired this" and
 * "you wired this to something that is not there" are different sentences and different fixes.
 */
export function unmappedControls(
  mapping: MixView | undefined,
): readonly MixControl[] {
  return REQUIRED_CONTROLS.filter((c) => !mapping?.[c.id]);
}
