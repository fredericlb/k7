// Overdrive — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// tanh(drive·x), drive climbing 1 → 50. What is approximated is the NORMALISATION: the exact makeup divides
// by tanh(drive), and this vocabulary has no tanh at control rate. Above drive 4 that divisor is within half a percent of 1, so the makeup only matters at the
// very bottom of the knob and a two-point ramp covers it.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  const drive = g.lerp(1, 50, t);
  // 1/tanh(1) = 1.313, and 1/tanh(4) = 1.001. linmap clamps, so past drive 4 this is flat.
  const makeup = g.lerp(1.313, 1.0, g.linmap(drive, 1, 4));

  const x = g.input();
  g.output(g.amul(g.saturate(x, drive), makeup));
};
