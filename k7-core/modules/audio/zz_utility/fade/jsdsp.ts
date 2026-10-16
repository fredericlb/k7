// The fade's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the `import type` is erased; see dspRunner.mjs).
//
// This is @studio/dsp's `fade()` graph, written out here: a module is a FOLDER you can copy, so it carries
// its own source rather than pointing at a shared library. packages/dsp/src/k7core.test.ts holds the two
// to the same graph.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // The gain itself, so a panel showing 0 means silent and 1 means full — no second number to read it through.
  const mix = g.param("Level", { min: 0, max: 1, default: 1 });
  g.output(g.amul(g.input(0), mix));
};
