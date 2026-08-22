// Stem cut — subtract a separated instrument from the mix it came out of. One param, one gain,
// and the gain is NEGATIVE: that is the whole module. See ../docs/stemcut.md for why a
// subtraction rather than a sum of stems, and what it guarantees at rest.

import { type GraphJson, graph } from "./index";

/** Nothing removed. A module dropped into a chain and left alone contributes silence, which is
 *  what makes the mix it is subtracted from come through untouched. */
export const DEFAULT_CUT = 0;

/**
 * The graph that removes one stem from a mix, as much as you ask for.
 *
 * It is fed the STEM and its output is added to the mix beside it, so the arithmetic is
 * `mix + (−Cut · stem)`. At `Cut = 0` the gain is zero and the sum is the mix, sample for
 * sample; at `Cut = 1` the stem is fully subtracted.
 *
 * **The negative gain is the point, and it is the only thing here that could not be done another
 * way.** Neither a fader (`MixerPlugin`, dB, floored at −60) nor a send (`gainToDecibels`) can
 * carry a sign; `Kind::gain` applies its control value with `buffer.applyGain`, unclamped, so a
 * graph can. Which is why a stem cut is a module and not a level.
 *
 * `sub(0, Cut)` rather than `mul(Cut, -1)`: one node either way, and this one reads as what it
 * is — nothing minus what you asked to take away.
 */
export function stemcut(): GraphJson {
  return graph((g) => {
    // 0..1 rather than dB: what a person asks for here is a PROPORTION of the instrument, and
    // half of it is −6 dB of that instrument, not a level to set. Full removal has to be
    // reachable, and −∞ dB is not a fader position.
    const cut = g.param("Cut", { min: 0, max: 1, default: DEFAULT_CUT });
    g.gain(g.sub(0, cut));
  });
}
