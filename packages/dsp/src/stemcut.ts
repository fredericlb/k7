// Stem cut — subtract a separated instrument from the mix it came out of. One param, one gain,
// and the gain is NEGATIVE: that is the whole module. See ../docs/stemcut.md for why a
// subtraction rather than a sum of stems, and what it guarantees at rest.

import { type GraphJson, graph } from "./index";

/** Nothing removed, so a module left alone contributes silence and the mix comes through untouched. */
export const DEFAULT_CUT = 0;

/** `mix + (−Cut · stem)`. The NEGATIVE gain is the point and the one thing no level can carry. */
export function stemcut(): GraphJson {
  return graph((g) => {
    // 0..1 rather than dB: a PROPORTION of the instrument, and −∞ dB is not a fader position.
    const cut = g.param("Cut", { min: 0, max: 1, default: DEFAULT_CUT });
    g.gain(g.sub(0, cut));
  });
}
