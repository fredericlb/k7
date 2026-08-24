// Stem cut — change how much of a separated instrument is in the mix it came out of. One param,
// one gain, and the gain is SIGNED: negative removes the instrument, positive adds more of it.
// See ../docs/stemcut.md for why this is a sum with the mix rather than a sum of four stems.

import { type GraphJson, graph } from "./index";

/** Centre: the record untouched, so a module left alone contributes silence. */
export const DEFAULT_LEVEL = 0;

/** `mix + (Level · stem)`. The sign is the point and the one thing no ordinary level can carry. */
export function stemcut(): GraphJson {
  return graph((g) => {
    // −1..1 rather than dB: a PROPORTION of the instrument, and −∞ dB is not a knob position.
    const level = g.param("Level", { min: -1, max: 1, default: DEFAULT_LEVEL });
    g.gain(level);
  });
}
