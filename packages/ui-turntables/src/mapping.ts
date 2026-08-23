// mapping.ts — which controls a `turntables` surface must have wired before it can be drawn,
// and which of them a given `mapping` is missing. The desk's own vocabulary: @studio/song
// validates the SHAPE of a mapping and deliberately not its ids.
// See packages/song/docs/surfaces.md.

import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import { MIX_CONTROLS, type MixControl } from "./controls";
import { DECKS } from "./deck";

/** The controls that must name a module — the ones that drive a PARAM, so not `transport`/`sync`/`listen`. */
const WIRED_PER_DECK = ["tempo", "eqLow", "eqMid", "eqHigh", "filter"] as const;

/** Every control a turntables surface needs wired, DERIVED from `DECKS` so a third deck is not skipped. */
export const REQUIRED_CONTROLS: readonly MixControl[] = MIX_CONTROLS.filter(
  (c) =>
    c.id === "crossfade" ||
    DECKS.some((d) =>
      WIRED_PER_DECK.some((suffix) => c.id === `${d}.${suffix}`),
    ),
);

/** The required controls this mapping does not NAME — a line pointing at nothing is `resolveBindings`'. */
export function unmappedControls(
  mapping: MixView | undefined,
): readonly MixControl[] {
  return REQUIRED_CONTROLS.filter((c) => !mapping?.[c.id]);
}
