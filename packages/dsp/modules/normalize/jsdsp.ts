// The normaliser's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and should never need one (the `import type` is
// erased; see @studio/song's dspRunner.mjs).
//
// This is @studio/dsp's `normalize()` graph, written out here: a module is a FOLDER you can
// copy, so it carries its own source rather than pointing at a shared library.
// packages/dsp/src/normalize.test.ts holds the two to the same shape.
//
// The graph is four nodes, and that is the point. Applying the gain is trivial; knowing WHICH
// gain cannot be done here at all — a streaming node sees the samples it has, and the loudest
// may be the last. So `Peak` is an input, filled in by the pass that reads the file end to end.
// That is what makes this module cold rather than merely expensive.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const target = g.param("Target", { min: -60, max: 0, default: -1 });
  const peak = g.param("Peak", { min: -100, max: 0, default: 0 });
  // Clamped: near silence measures -100 dBFS and would ask for +99 dB, turning hiss into a roar.
  const gainDb = g.clamp(g.sub(target, peak), -60, 30);
  g.gain(g.fromdb(gainDb));
};
