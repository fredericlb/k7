// Stem cut — how much of one separated part a deck plays. The lane carries the PART itself, not
// the record, so this is an ordinary level: 0 drops the instrument, 1 is as it was cut, 2 doubles
// it. See ../docs/stemcut.md for why a deck sums four parts rather than subtracting from a mix.

import { type GraphJson, graph } from "./index";

/** Unity: the part as the separation wrote it, which is where a knob nobody has touched sits. */
export const DEFAULT_LEVEL = 1;

/** `Level * part`. One multiplication, and the whole module. */
export function stemcut(): GraphJson {
  return graph((g) => {
    // 0..2 rather than dB: silence has to be reachable, and -Inf dB is not a knob position.
    const level = g.param("Level", { min: 0, max: 2, default: DEFAULT_LEVEL });
    g.gain(level);
  });
}
