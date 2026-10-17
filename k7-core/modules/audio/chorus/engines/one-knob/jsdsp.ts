// Chorus — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// A 30 ms tap swept ±20 ms by a sine, mixed 30% under the dry. The sweep is a
// WIRE and not a scalar: a control-rate delay time steps once a block, and on a delay that is a zipper on
// precisely the effect modulation exists for.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  const rate = g.lerp(0.2, 5, t); // Hz
  const depth = g.mul(t, 20); // ms

  const dry = g.input();
  const timeMs = g.aadd(g.amul(g.lfo("sine", rate), depth), 30);
  // 60 ms ceiling: allocated once at prepare, so it has to clear 30 + 20 with room to spare.
  const wet = g.delay(dry, timeMs, 60);
  g.output(g.aadd(g.amul(dry, 0.7), g.amul(wet, 0.3)));
};
