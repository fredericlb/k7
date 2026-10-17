// Low Pass — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// One knob, 0..100: a single number saying "how muffled".
// The map is GEOMETRIC — 20 kHz down to 200 Hz — since a linear sweep over that span spends nine tenths of the
// knob in territory nobody can hear moving.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  // At 0 the corner sits at 20 kHz: above anything in the material, so the effect is off by being inaudible
  // rather than by being bypassed. There is no bypass in this vocabulary, and a module that has to be removed
  // to be silent is a module a chain cannot automate.
  g.biquad("lowpass", g.geolerp(20000, 200, t), 1);
};
