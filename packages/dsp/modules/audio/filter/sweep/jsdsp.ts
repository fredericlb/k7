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
  // How far from centre, either way. A sum rather than a maximum because only one of the two
  // is ever non-zero — and the builder has no `max`.
  const depth = g.add(down, up);

  // Resonance CLIMBS with how far the knob has been pushed: 0.707 is Butterworth, maximally
  // flat, so a filter doing nothing also colours nothing; 6 whistles. A permanently resonant
  // filter rings even parked out of the way, and a permanently flat one is a tone control.
  //
  // 6 rather than a polite 4, measured: at 4 only about +4 dB was left at the corner once the
  // flat stage below it had taken its own 3 dB, which is audible but is not what anybody means
  // by a filter sweep.
  //
  // Each half gets its OWN. Sharing one would leave the high-pass ringing at 20 Hz while
  // somebody sweeps the low-pass down — a resonant peak parked on the sub.
  const lowQ = g.lerp(0.707, 6, down);
  const highQ = g.lerp(0.707, 6, up);

  // `glide` on both corners. A biquad recomputes its coefficients per BLOCK, and this is a
  // knob people throw — a jump between two blocks is a click, and a sweep of them is the
  // zipper noise that makes a filter sound broken rather than fast.
  //
  // At 0 the low-pass sits at 20 kHz and the high-pass at 20 Hz: both outside the material, so
  // the effect is off by being INAUDIBLE rather than by being bypassed. There is no bypass in
  // this vocabulary, and a module that must be removed to be silent is one a chain cannot
  // automate from nothing.
  //
  // The low-pass closes to 30 Hz and the high-pass opens to 10 kHz: far enough to take the
  // track AWAY. A filter that stopped a few hundred hertz down leaves a muddy thump, and the
  // last part of the sweep — only the peak left whistling — is the part people actually use.
  // ASCENDING pair, and the journey inverted — never `geolerp(20000, 30, down)`. The engine
  // sorts a geolerp's ends, so a descending pair reads as its own mirror: written the obvious
  // way this filter sat at 30 Hz at rest and OPENED as you swept, which is silence with the
  // knob at neutral.
  const lowHz = g.glide(g.geolerp(30, 20000, g.sub(1, down)));
  const highHz = g.glide(g.geolerp(20, 10000, up));

  // TWO stages each, so the slope is 24 dB/octave rather than 12. One pole pair muffles; two
  // is the wall a DJ filter puts up. The first of each pair stays FLAT and only the second
  // resonates: two resonant stages at one frequency multiply their peaks — Q² — which is a
  // filter that screams before it sweeps.
  g.biquad("lowpass", lowHz, 0.707);
  g.biquad("lowpass", lowHz, lowQ);
  g.biquad("highpass", highHz, 0.707);
  g.biquad("highpass", highHz, highQ);

  // …and the trim, LAST, so it takes back a little of what the stages above just added. Only
  // −3 dB at the extreme: the first attempt took −6 and ate the peak exactly where the peak is
  // the point, and the clipping it guarded against was theoretical — the filter removes 14 dB
  // from the whole signal at half sweep. What is left keeps a Q of 6 on a 30 Hz kick from
  // costing somebody their master.
  g.gain(g.lerp(1, 0.7, depth));
};
