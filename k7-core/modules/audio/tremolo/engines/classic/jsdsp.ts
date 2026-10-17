// The tremolo's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a
// song folder has no node_modules and should never need one (the `import type` is erased; see
// @studio/song's docs/jsdspJail.md).
//
// This is @studio/dsp's `tremolo()` graph, written out here: a module is a FOLDER you can copy, so it
// carries its own source rather than pointing at a shared library. packages/dsp/src/k7core.test.ts
// holds the two to the same graph.
//
// The LFO runs at SAMPLE rate. A gain stepped once per block is a ~10 ms staircase, which on a
// tremolo is the effect itself made of steps — audible as a stutter rather than a swell.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const rate = g.param("Rate", { min: 0.1, max: 20, default: 5 });
  const depth = g.param("Depth", { min: 0, max: 1, default: 0.5 });

  const dry = g.input();
  // The LFO is bipolar; the gain wants 0..1, so it is offset and halved before anything scales it.
  const unipolar = g.amul(g.aadd(g.lfo("sine", rate), 1), 0.5);
  // gain = (1 - depth) + depth * unipolar — the floor rises as depth falls, so depth 0 is unity.
  const amount = g.aadd(g.amul(unipolar, depth), g.sub(1, depth));
  g.output(g.amul(dry, amount));
};
