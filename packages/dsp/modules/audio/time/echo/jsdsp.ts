// The echo's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the `import type` is erased; see dspRunner.mjs).
//
// This is @studio/dsp's `echo()` graph, written out here: a module is a FOLDER you can copy, so it carries
// its own source rather than pointing at a shared library. packages/dsp/src/echo.test.ts holds the two to
// the same shape.
//
// The loop is the point: `fb` is READ by the sum that feeds the delay, and WRITTEN by that same delay one
// line later. Inside the per-sample loop that read sees the previous sample — the unit delay every feedback
// topology is drawn with. Nothing here declares a cycle; the order of the lines is the circuit.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const time = g.param("Time", { min: 1, max: 900, default: 250 });
  // Capped below 1 on purpose: at 1 the loop never decays, and a runaway is not a setting.
  const feedback = g.param("Feedback", { min: 0, max: 0.95, default: 0.6 });
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });

  const dry = g.input();
  const fb = g.wire("fb"); // named ahead of its writer — that IS the loop
  const into = g.aadd(dry, g.amul(fb, feedback));
  g.delay(into, time, 1000, fb); // …and here is what writes it, one line later
  g.output(g.aadd(dry, fb));
  g.mix(mix);
};
