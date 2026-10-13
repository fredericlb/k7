// Parametric EQ — the DSP itself, as a description the engine runs. Edit this file and the module
// changes; the .json beside it is the build, regenerated whenever this is newer.
//
// Five bands in series: a low shelf, three peaks and a high shelf, each with its own frequency,
// gain and Q. A band at 0 dB is the identity, so an untouched band colours nothing.
// Frequency and gain glide: a biquad recomputes per block, and a dragged point is a thrown knob.

import type { GraphBuilder } from "@studio/dsp";

type Mode = "peak" | "lowshelf" | "highshelf";

// Name, filter, frequency range and default, Q range and default — widgets.js keeps the same table.
const BANDS: [string, Mode, number, number, number, number, number, number][] = [
  ["Low", "lowshelf", 20, 1000, 100, 0.3, 2, 0.707],
  ["Low Mid", "peak", 40, 4000, 300, 0.1, 10, 1],
  ["Mid", "peak", 200, 8000, 1000, 0.1, 10, 1],
  ["High Mid", "peak", 800, 16000, 3500, 0.1, 10, 1],
  ["High", "highshelf", 1000, 20000, 8000, 0.3, 2, 0.707],
];

export default (g: GraphBuilder) => {
  for (const [name, mode, fLo, fHi, fDef, qLo, qHi, qDef] of BANDS) {
    const freq = g.param(`${name} Freq`, { min: fLo, max: fHi, default: fDef });
    const gain = g.param(`${name} Gain`, { min: -18, max: 18, default: 0 });
    const q = g.param(`${name} Q`, { min: qLo, max: qHi, default: qDef });
    g.biquad(mode, g.glide(freq), q, g.glide(gain));
  }
};
