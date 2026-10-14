// Flanger — the DSP itself, as a description the engine runs. Edit this file and the module changes; the .json
// beside it is the build, regenerated whenever this is newer.
//
// Two things make it possible at all, and neither is ordinary: the delay's output feeds back into its own input,
// and its time is swept EVERY SAMPLE. A block-rate sweep would step the delay ~10 ms at a time and zipper.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const rate = g.param("Rate", { min: 0.05, max: 10, default: 0.4 });
  const depth = g.param("Depth", { min: 0, max: 8, default: 3 });
  const centre = g.param("Centre", { min: 0.5, max: 12, default: 5 });
  // Capped below 1: at 1 the loop never decays, and a runaway is not a setting.
  const feedback = g.param("Feedback", { min: 0, max: 0.9, default: 0.5 });
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });

  const dry = g.input();
  // centre + depth·sin(2π·rate·t), in milliseconds, evaluated every sample.
  const timeMs = g.aadd(g.amul(g.lfo("sine", rate), depth), centre);

  // The loop: `fb` is READ by the sum feeding the delay and WRITTEN by that delay one line later. Inside the
  // per-sample loop that read sees the previous sample — the unit delay every feedback topology is drawn with.
  const fb = g.wire("fb");
  const into = g.aadd(dry, g.amul(fb, feedback));
  g.delay(into, timeMs, 20, fb); // 20 ms ceiling: allocated once, so it bounds Centre + Depth
  g.output(g.aadd(dry, fb));
  g.mix(mix);
};
