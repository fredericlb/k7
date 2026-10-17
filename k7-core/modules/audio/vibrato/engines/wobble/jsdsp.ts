// Pitch Wobble — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
//
// Warped vinyl. Nothing here can retune a buffer, so the pitch comes from where it comes from on tape — a
// delay line whose length MOVES. The three rates (0.23, 0.71, 1.37 Hz, scaled by the knob) are mutually
// irrational on purpose: the wobble must never settle into a pattern an ear can predict.
//
// No random drift: a graph has no noise source, so three incommensurable sines stand in for "never repeats".

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const amount = g.param("Amount", { min: 0, max: 100, default: 0 });
  const t = g.mul(amount, 0.01);
  const rateScale = g.lerp(0.3, 3.3, t);
  const depth = g.mul(t, 25); // ms, before the per-oscillator weights

  const dry = g.input();
  const w1 = g.amul(g.lfo("sine", g.mul(rateScale, 0.23)), depth);
  const w2 = g.amul(g.lfo("sine", g.mul(rateScale, 0.71)), g.mul(depth, 0.6));
  const w3 = g.amul(g.lfo("sine", g.mul(rateScale, 1.37)), g.mul(depth, 0.35));
  // 60 ms of base, so the sum (up to ±49 ms) never asks for a negative delay — which the engine would clamp
  // to zero, and a clamped modulator is a wobble that flattens at its own extreme.
  const timeMs = g.aadd(g.aadd(g.aadd(w1, w2), w3), 60);
  g.output(g.delay(dry, timeMs, 130));
};
