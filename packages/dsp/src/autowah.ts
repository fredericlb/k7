// The Auto Wah, written in JS — the same effect the engine ships as a compiled plugin, as a description.
//
// It began as a compiled C++ plugin (AutoWahPlugin), and this description was checked against it until the two
// rendered bit-identical samples. That plugin is gone now — one auto-wah is enough, and the editable one is the
// one worth keeping — so what pins this file today is autowah.test.ts, which holds it against the fallback graph
// the engine still carries.

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

    // Sensitivity moves the level that reaches the TOP of the sweep: -60 dB when turned up, -15 dB when down.
    // Shaped in dB because playing dynamics are logarithmic — a linear map spends its travel on the loudest few
    // dB and feels dead everywhere else.
    const floorDb = g.lerp(-60, -15, sens);
    const up = g.linmap(envDb, floorDb, 0);
    const travel = g.select(up, g.sub(1, up), direction);

    // Geometric, because pitch is: a linear sweep crawls at the bottom and races at the top, which is the single
    // thing that makes a filter sweep sound synthetic instead of like a pedal.
    let freq = g.geolerp(low, high, travel);
    freq = g.clamp(freq, 60, g.mul(sr, 0.45)); // an unstable coefficient above Nyquist would be a NaN downstream
    freq = g.glide(freq); // one block of slew, so a per-block coefficient step cannot zipper

    g.biquad("bandpass", freq, res);
    g.mix(mix);
  });
}
