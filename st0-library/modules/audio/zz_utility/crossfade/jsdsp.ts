// Crossfade — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// `input(0)` and `input(1)` index the ports module.yaml declares, in order: `a` then `b`. An index and not a
// name, because this graph is compiled to JSON the engine reads with no module.yaml in sight, and position is
// the one fact both documents can hold on their own.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
  // Equal GAIN, not equal power — there is no sqrt among the primitives, and adding one for a single effect
  // is how a graph language ends up with a node per effect. Linear dips ~3 dB at centre for uncorrelated
  // material, which is a known shape rather than a bug.
  const a = g.amul(g.input(0), g.sub(1, mix));
  const b = g.amul(g.input(1), mix);
  g.output(g.aadd(a, b));
};
