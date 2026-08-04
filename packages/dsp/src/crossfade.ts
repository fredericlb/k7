// A crossfade — the effect that needed the ports layer, the way the flanger needed feedback. Two audio inputs
// was simply unsayable while a module's ports came from its type folder, and no amount of arithmetic worked
// around it: the second signal had nowhere to enter.
//
// So the graph itself is almost nothing. `input(1)` reads the module's SECOND declared port and everything
// after it is one weighted sum. That is the point — the interesting part was making the port exist.

import { type GraphJson, graph } from "./index";

export function crossfade(): GraphJson {
  return graph((g) => {
    const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
    // Equal GAIN, not equal power. A DJ crossfader usually takes the square root of each side, so two
    // uncorrelated tracks keep a steady loudness through the middle; there is no sqrt among the primitives,
    // and inventing one for a single effect is how a graph language ends up with a node per effect (see
    // DspGraph.h). Linear dips ~3 dB at centre for uncorrelated material, which is a known shape, not a bug.
    const a = g.amul(g.input(0), g.sub(1, mix));
    const b = g.amul(g.input(1), mix);
    g.output(g.aadd(a, b));
  });
}
