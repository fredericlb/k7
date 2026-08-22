// The stem cut's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and should never need one (the `import type` is
// erased; see @studio/song's dspRunner.mjs).
//
// This is @studio/dsp's `stemcut()` graph, written out here: a module is a FOLDER you can copy,
// so it carries its own source rather than pointing at a shared library.
// packages/dsp/src/stemcut.test.ts runs THIS file and holds the two to the same graph.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const cut = g.param("Cut", { min: 0, max: 1, default: 0 });
  // A NEGATIVE gain — the one thing no fader and no send can express, and the reason this is a
  // module. `mix + (−Cut · stem)` is a subtraction that costs nothing at rest: at Cut 0 this lane
  // contributes silence, so the mix beside it comes through sample for sample.
  g.gain(g.sub(0, cut));
};
