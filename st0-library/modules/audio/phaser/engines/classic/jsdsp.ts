// Phaser — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
// Tracktion's phaser, stage for stage: its knobs are plain plugin state, so a curve could never move them.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const depth = g.param("Depth", { min: 0, max: 10, default: 5 });
  const rate = g.param("Rate", { min: 0, max: 10, default: 0.4 });
  const feedback = g.param("Feedback", { min: 0, max: 1, default: 0.7 });

  const dry = g.input();
  // A triangle, 0..1, times Depth: the plugin sweeps evenly in PITCH, so it is octaves that move linearly.
  const tri = g.lfo("triangle", rate);
  const octaves = g.amul(g.aadd(g.amul(tri, 0.5), 0.5), depth);

  // Read before the last stage writes it, so it is that stage's PREVIOUS sample — the plugin's feedback tap.
  const fb = g.wire("fb");
  let x = g.aadd(dry, g.amul(fb, feedback));
  for (let i = 0; i < 3; i++) x = g.allpass(x, 100, octaves);
  g.allpass(x, 100, octaves, fb);
  g.output(g.aadd(dry, fb));
};
