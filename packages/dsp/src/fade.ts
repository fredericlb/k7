// A fade — one input, one gain, and the gain IS the parameter. Two of them driven in mirror ARE a
// crossfader, without the second port a crossfade needs: each deck keeps its own ordinary track and
// its own ordinary output, and the blend happens where they meet at the mixer.
//
// Why that matters rather than being a rewrite for its own sake: docs/catalogue.md.

import { type GraphJson, graph } from "./index";

export function fade(): GraphJson {
  return graph((g) => {
    // The gain itself, so a panel showing 0 means silent and 1 means full — `Level`, never `Mix`, which names a dry/wet.
    const level = g.param("Level", { min: 0, max: 1, default: 1 });
    g.output(g.amul(g.input(0), level));
  });
}
