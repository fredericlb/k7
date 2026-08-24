// The fade's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the `import type` is erased; see dspRunner.mjs).
//
// This is @studio/dsp's `fade()` graph, written out here: a module is a FOLDER you can copy, so it carries
// its own source rather than pointing at a shared library. packages/dsp/src/fade.test.ts holds the two to
// the same shape.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // What the desk's one control drives, on BOTH sides at once — the opposition is `Side`, not the value.
  const mix = g.param("Mix", { min: 0, max: 1, default: 0 });
  // 0 fades OUT as Mix rises, 1 fades IN. A node's own setting, never a control's.
  const side = g.param("Side", { min: 0, max: 1, default: 0 });
  // (1−Side)·(1−Mix) + Side·Mix — no branch among the primitives, so the choice is arithmetic.
  const gain = g.add(g.mul(g.sub(1, side), g.sub(1, mix)), g.mul(side, mix));
  g.output(g.amul(g.input(0), gain));
};
