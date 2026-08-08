// The sweep filter's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and should never need one (the `import type` is
// erased; see @studio/song's dspRunner.mjs).
//
// This is @studio/dsp's `sweepFilter()` graph, written out here: a module is a FOLDER you can
// copy, so it carries its own source rather than pointing at a shared library.
// packages/dsp/src/sweep.test.ts holds the two to the same shape.
//
// ONE knob, because a desk control drives at most one param — so "low-pass or high-pass"
// cannot be a second setting somebody flips. Both filters are therefore always in the chain,
// and what moves is where each one sits.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const sweep = g.param("Sweep", { min: -100, max: 100, default: 0 });
  // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
  const t = g.mul(sweep, 0.01);
  const down = g.clamp(g.mul(t, -1), 0, 1);
  const up = g.clamp(t, 0, 1);

  // `glide` on both corners. A biquad recomputes its coefficients per BLOCK, and this is a
  // knob people throw — a jump between two blocks is a click, and a sweep of them is the
  // zipper noise that makes a filter sound broken rather than fast.
  //
  // At 0 the low-pass sits at 20 kHz and the high-pass at 20 Hz: both outside the material, so
  // the effect is off by being INAUDIBLE rather than by being bypassed. There is no bypass in
  // this vocabulary, and a module that must be removed to be silent is one a chain cannot
  // automate from nothing.
  //
  // The low-pass runs FIRST, so at the far left the high-pass sees the muffled signal rather
  // than the raw one. The high-pass stops at 4 kHz where the low-pass falls to 200: the two
  // halves are not symmetric in use — sweeping the bass out is a build, and it ends at air.
  g.biquad("lowpass", g.glide(g.geolerp(20000, 200, down)), 1);
  g.biquad("highpass", g.glide(g.geolerp(20, 4000, up)), 1);
};
