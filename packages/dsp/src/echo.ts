// A feedback delay, written in JS — the effect the block-rate phases could not express at all.
//
// The loop is the point: `fb` is READ by the sum that feeds the delay, and WRITTEN by that same delay one line
// later. Inside the per-sample loop that read sees the previous sample, which is the unit delay every feedback
// topology is drawn with. Nothing here declares a cycle; the order of the lines is the circuit.

import { type GraphJson, graph } from "./index";

export function echo(): GraphJson {
  return graph((g) => {
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
  });
}
