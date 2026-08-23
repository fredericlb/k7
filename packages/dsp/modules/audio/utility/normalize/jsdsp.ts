// The normaliser's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and never should.
//
// @studio/dsp's `normalize()` graph written out here, because a module is a FOLDER you can copy.
// src/normalize.test.ts holds the two to the same shape.
//
// `Peak` is an INPUT, and that is what makes this module cold rather than merely expensive: a
// streaming node sees only the samples it has, and the loudest may be the last — so the gain is
// filled in by the pass that reads the file end to end.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const target = g.param("Target", { min: -60, max: 0, default: -1 });
  const peak = g.param("Peak", { min: -100, max: 0, default: 0 });
  // Clamped: near silence measures -100 dBFS and would ask for +99 dB, turning hiss into a roar.
  const gainDb = g.clamp(g.sub(target, peak), -60, 30);
  g.gain(g.fromdb(gainDb));
};
