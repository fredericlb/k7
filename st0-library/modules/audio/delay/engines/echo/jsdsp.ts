// Echo — the DSP itself, as a description the engine runs. Edit this file and the module changes;
// the .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no
// node_modules. Taken from `@studio/dsp`'s own `echo()`, which is where the topology is explained
// and tested.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // MILLISECONDS, which is the point of this module: every delay the engine ships takes its time
  // as a 0..1 fraction. 900 against the 1000 ms buffer below, so the ceiling is this parameter's.
  const time = g.param("Time", { min: 1, max: 900, default: 250 });
  // Capped below 1 on purpose: at 1 the loop never decays, and a runaway is not a setting.
  const feedback = g.param("Feedback", { min: 0, max: 0.95, default: 0.6 });
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });

  // The loop is the point: `fb` is READ by the sum that feeds the delay, and WRITTEN by that same
  // delay one line later. Inside the per-sample loop that read sees the previous sample, which is
  // the unit delay every feedback topology is drawn with. Nothing here declares a cycle; the
  // ORDER OF THE LINES is the circuit.
  const dry = g.input();
  const fb = g.wire("fb"); // named ahead of its writer — that IS the loop
  const into = g.aadd(dry, g.amul(fb, feedback));
  g.delay(into, time, 1000, fb); // …and here is what writes it, one line later
  g.output(g.aadd(dry, fb));
  g.mix(mix);
};
