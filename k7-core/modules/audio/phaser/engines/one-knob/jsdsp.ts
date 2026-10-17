// Phaser — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// An APPROXIMATION, and the honest name for what it does is a swept comb: dry minus a short, moving tap, so
// the notches slide the way a phaser's do. The exact phaser, four
// all-pass stages with a feedback tap, is the `classic` engine beside this one.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  // The sweep speed: 0.1 Hz at rest, 4 Hz wide open.
  const rate = g.lerp(0.1, 4, t);
  const depth = g.mul(t, 1.9); // ms

  const dry = g.input();
  // 2.2 ms centre: the first notch lands near 230 Hz and the sweep carries the family up past 3 kHz.
  const timeMs = g.aadd(g.amul(g.lfo("sine", rate), depth), 2.2);
  const wet = g.delay(dry, timeMs, 8);
  // MINUS the tap, not plus: subtracting puts a notch where adding would put a peak, and notches are what a
  // phaser is heard by.
  g.output(g.aadd(g.amul(dry, 0.5), g.amul(wet, -0.5)));
};
