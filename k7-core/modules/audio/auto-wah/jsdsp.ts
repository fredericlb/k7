// Auto Wah — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const low = g.param("Low", { min: 60, max: 8000, default: 200 });
  const high = g.param("High", { min: 60, max: 8000, default: 2400 });
  const sens = g.param("Sensitivity", { min: 0, max: 1, default: 0.5 });
  const res = g.param("Resonance", { min: 0.5, max: 20, default: 4 });
  const attack = g.param("Attack", { min: 0.1, max: 200, default: 8 });
  const release = g.param("Release", { min: 1, max: 1000, default: 120 });
  const mix = g.param("Mix", { min: 0, max: 1, default: 1 });
  // A band-pass throws away everything outside its band, so wet is far quieter than dry — measured at -14.7 dB
  // on a broadband source at the default Q. That is physics, not a fault, but it needs a knob.
  const output = g.param("Output", { min: -20, max: 40, default: 15 });
  const direction = g.param("Direction", {
    min: 0, max: 1, default: 0, labels: ["up", "down"],
  });

  // How hard you are playing, followed per sample.
  const envDb = g.todb(g.envelope(attack, release));

  // Sensitivity moves the level that reaches the TOP of the sweep: -60 dB turned up, -15 dB turned down.
  // Shaped in dB because playing dynamics are logarithmic — a linear map spends its travel on the loudest few
  // dB and feels dead everywhere else.
  const floorDb = g.lerp(-60, -15, sens);
  const up = g.linmap(envDb, floorDb, 0);
  const travel = g.select(up, g.sub(1, up), direction);

  // Geometric, because pitch is: a linear sweep crawls at the bottom and races at the top, which is the single
  // thing that makes a filter sweep sound synthetic instead of like a pedal.
  let freq = g.geolerp(low, high, travel);
  freq = g.clamp(freq, 60, g.mul(g.sr, 0.45)); // Nyquist — a coefficient above it is a NaN downstream
  freq = g.glide(freq);                        // one block of slew, so a step cannot zipper

  g.biquad("bandpass", freq, res);

  // Make-up gain, with the RESONANCE compensated out of it: a band-pass loses ~3 dB of energy per doubling of Q
  // (measured: -11.7 dB at Q=2, -21.8 dB at Q=16), so without this, reaching for resonance would also be
  // reaching for the fader. Referenced to Q=4, so `Output` alone sets the level and Q only changes the colour.
  //   0.5·todb(x) is 10·log10(x) — half of 20·log10 — which is the dB form of energy ∝ 1/Q.
  const comp = g.mul(g.sub(g.todb(res), g.todb(4)), 0.5);
  g.gain(g.fromdb(g.add(output, comp)));

  g.mix(mix);
};
