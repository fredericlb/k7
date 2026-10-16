// The DJ filter's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and should never need one (the `import type` is
// erased; see @studio/song's dspRunner.mjs).
//
// This is @studio/dsp's `sweepFilter()` graph, written out here: a module is a FOLDER you can
// copy, so it carries its own source. packages/dsp/src/k7core.test.ts holds the two to the same
// graph, and packages/dsp/docs/sweep.md holds the numbers and the reasons.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const sweep = g.param("Sweep", { min: -100, max: 100, default: 0 });
  // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
  const t = g.mul(sweep, 0.01);
  const down = g.clamp(g.mul(t, -1), 0, 1);
  const up = g.clamp(t, 0, 1);
  // How far from centre, either way. A sum, since only one of the two is ever non-zero.
  const depth = g.add(down, up);

  // Each filter's resonance follows ITS OWN half, or the high-pass rings on the sub.
  const lowQ = g.lerp(0.707, 6, down);
  const highQ = g.lerp(0.707, 6, up);

  // `glide` on both corners: a biquad recomputes per BLOCK, and this is a knob people throw.
  // ASCENDING pair, journey inverted — never `geolerp(20000, 30, down)`; packages/dsp/docs/sweep.md.
  const lowHz = g.glide(g.geolerp(30, 20000, g.sub(1, down)));
  const highHz = g.glide(g.geolerp(20, 10000, up));

  // TWO stages each for 24 dB/octave, and only the SECOND resonates — Q² screams before it sweeps.
  g.biquad("lowpass", lowHz, 0.707);
  g.biquad("lowpass", lowHz, lowQ);
  g.biquad("highpass", highHz, 0.707);
  g.biquad("highpass", highHz, highQ);

  // …and the trim, LAST, so it takes back the peak the stages above just added.
  g.gain(g.lerp(1, 0.7, depth));
};
