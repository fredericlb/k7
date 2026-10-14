// The crossfade's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the `import type` is erased; see dspRunner.mjs).
//
// `input(0)` and `input(1)` index the ports module.yaml declares, in order: `a` then `b`. An index and not a
// name, because this graph is compiled to JSON the engine reads with no module.yaml in sight, and position is
// the one fact both documents can hold on their own.
//
// This is @studio/dsp's `crossfade()` graph, written out here: a module is a FOLDER you can copy, so it
// carries its own source rather than pointing at a shared library. packages/dsp/src/crossfade.test.ts holds
// the two to the same shape.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
  // Equal GAIN and not equal power: no sqrt among the primitives, so the centre dips a known ~3 dB.
  g.input(0).mul(mix.from(1)).add(g.input(1).mul(mix)).out();
};
