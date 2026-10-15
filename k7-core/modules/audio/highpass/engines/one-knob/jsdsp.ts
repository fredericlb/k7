// High Pass — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// The low pass's mirror, and the asymmetry is deliberate: 20 Hz at 0 (below the material, so it does nothing)
// climbing to 20 kHz at 100 (above it, so almost nothing is left). Both ends are useless on purpose — the knob
// is a blindtest's "how thin", and a question wants the whole span available.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  g.biquad("highpass", g.geolerp(20, 20000, t), 1);
};
