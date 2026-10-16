// The Auto Wah, written in JS — the effect as a description rather than as a compiled plugin.
//
// It is the engine's fallback graph: autowah.test.ts holds this file against GraphDspPlugin.cpp, so the
// two cannot drift apart. k7-core's auto-wah module is a different graph, with an `Output` make-up stage.

import { type GraphJson, graph, sr } from "./index";

/** The reference auto-wah. `targetDb` is where the sensitivity curve tops out — see below. */
export function autoWah(): GraphJson {
  return graph((g) => {
    const low = g.param("Low", { min: 60, max: 8000, default: 200 });
    const high = g.param("High", { min: 60, max: 8000, default: 2400 });
    const sens = g.param("Sensitivity", { min: 0, max: 1, default: 0.5 });
    const res = g.param("Resonance", { min: 0.5, max: 20, default: 4 });
    const attack = g.param("Attack", { min: 0.1, max: 200, default: 8 });
    const release = g.param("Release", { min: 1, max: 1000, default: 120 });
    const mix = g.param("Mix", { min: 0, max: 1, default: 1 });
    const direction = g.param("Direction", {
      min: 0,
      max: 1,
      default: 0,
      labels: ["up", "down"],
    });

    // How hard you are playing, followed per sample.
    const envDb = g.todb(g.envelope(attack, release));

    // Sensitivity moves the level reaching the TOP of the sweep, in dB because dynamics are logarithmic.
    const floorDb = g.lerp(-60, -15, sens);
    const up = g.linmap(envDb, floorDb, 0);
    const travel = g.select(up, g.sub(1, up), direction);

    // Geometric, because pitch is: a linear sweep is the one thing that sounds synthetic here.
    let freq = g.geolerp(low, high, travel);
    freq = g.clamp(freq, 60, g.mul(sr, 0.45)); // an unstable coefficient above Nyquist would be a NaN downstream
    freq = g.glide(freq); // one block of slew, so a per-block coefficient step cannot zipper

    g.biquad("bandpass", freq, res);
    g.mix(mix);
  });
}
