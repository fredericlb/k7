// A crossfade — the effect that needs the ports layer, the way the flanger needs feedback. Two audio inputs
// are unsayable while a module's ports come from its type folder, and no amount of arithmetic works around
// it: the second signal has nowhere to enter.
//
// So the graph itself is almost nothing. `input(1)` reads the module's SECOND declared port and everything
// after it is one weighted sum. That is the point — the interesting part is making the port exist.

import { type GraphJson, graph } from "./index";

export function crossfade(): GraphJson {
  return graph((g) => {
    const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
    // Equal GAIN, not equal power: no sqrt among the primitives, so ~3 dB dips at centre, knowingly.
    const a = g.amul(g.input(0), g.sub(1, mix));
    const b = g.amul(g.input(1), mix);
    g.output(g.aadd(a, b));
  });
}
