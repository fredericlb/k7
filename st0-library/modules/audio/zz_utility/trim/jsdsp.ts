// The trim's DSP — the same one line as `gain` beside it, over a narrower and SIGNED range.
//
// Two files rather than one shared source because a module is a FOLDER you can copy: what makes this
// a trim rather than a fader is its range, and a range lives in the param. See ../gain/jsdsp.ts.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // Symmetrical, so the rest position is the MIDDLE of the travel rather than one end of it.
  const db = g.param("Trim", { min: -12, max: 12, default: 0 });
  g.output(g.amul(g.input(0), g.fromdb(db)));
};
