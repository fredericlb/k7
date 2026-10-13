// Normalize — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// The graph is four nodes, and that is the point. Applying the gain is trivial; knowing WHICH gain cannot be
// done here at all — a streaming node sees only the samples it has, and the loudest may be the last. So `Peak`
// is an INPUT, filled in by the pass that reads the file end to end. That is what makes this module cold
// rather than merely expensive.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const target = g.param("Target", { min: -60, max: 0, default: -1 });
  const peak = g.param("Peak", { min: -100, max: 0, default: 0 });
  // Clamped: near silence measures -100 dBFS and would ask for +99 dB, turning hiss into a roar.
  const gainDb = g.clamp(g.sub(target, peak), -60, 30);
  g.gain(g.fromdb(gainDb));
};
