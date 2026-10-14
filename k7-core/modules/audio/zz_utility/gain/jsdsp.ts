// The gain's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the `import type` is erased; see dspRunner.mjs).
//
// One line of arithmetic, and the only thing worth reading is `fromdb`: the parameter is in DECIBELS,
// so it has to be converted before it can multiply samples. See packages/dsp/src/gain.test.ts.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // -60 is the FLOOR and reads as silence: a fader has a bottom, and -Infinity is not a position.
  const db = g.param("Gain", { min: -60, max: 6, default: 0 });
  g.output(g.amul(g.input(0), g.fromdb(db)));
};
