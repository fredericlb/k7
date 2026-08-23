// The DJ filter's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and never should.
//
// @studio/dsp's `sweepFilter()` graph written out here, because a module is a FOLDER you can
// copy: it carries its own source. src/sweep.test.ts holds the two to the same shape.
//
// ONE knob, so "low-pass or high-pass" cannot become a second setting: both filters are always
// in the chain and what moves is where each sits. The RESONANCE is what makes it a DJ filter
// rather than a filter — a peak travelling with the corner, not a corner sliding alone.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const sweep = g.param("Sweep", { min: -100, max: 100, default: 0 });
  // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
  const t = g.mul(sweep, 0.01);
  const down = g.clamp(g.mul(t, -1), 0, 1);
  const up = g.clamp(t, 0, 1);
  // How far from centre, either way. A sum, since only one of the two is ever non-zero.
  const depth = g.add(down, up);

  // Resonance CLIMBS from Butterworth to a measured 6, and each half gets its OWN ramp.
  const lowQ = g.lerp(0.707, 6, down);
  const highQ = g.lerp(0.707, 6, up);

  // `glide` on both corners: a biquad recomputes per BLOCK, and this is a knob people throw.

  // At 0 both corners sit outside the material, so the effect is off by being INAUDIBLE.

  // ASCENDING pair, journey inverted — never `geolerp(20000, 30, down)`; the engine sorts them.
  const lowHz = g.glide(g.geolerp(30, 20000, g.sub(1, down)));
  const highHz = g.glide(g.geolerp(20, 10000, up));

  // TWO stages each for 24 dB/octave, and only the SECOND resonates — Q² screams before it sweeps.
  g.biquad("lowpass", lowHz, 0.707);
  g.biquad("lowpass", lowHz, lowQ);
  g.biquad("highpass", highHz, 0.707);
  g.biquad("highpass", highHz, highQ);

  // …and the trim, LAST: only −3 dB at the extreme, because −6 ate the peak that is the point.
  g.gain(g.lerp(1, 0.7, depth));
};
