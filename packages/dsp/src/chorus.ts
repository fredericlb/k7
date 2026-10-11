// A chorus — Tracktion's, rebuilt as a graph so its knobs can be AUTOMATED (the plugin keeps them as
// plain state). One delay swept between 20 and 20 + `Depth` ms by a sine at `Speed` Hz, the right
// channel `Width` half a cycle ahead. Same names, ranges and defaults as the plugin, but for `Mix`: a
// module's blend is the engine's own `@mix` stage, so the graph is all wet and the module sets `mix: 0.5`.

import { type GraphJson, graph } from "./index";

export function chorus(): GraphJson {
  return graph((g) => {
    const depth = g.param("Depth", { min: 0, max: 20, default: 3 });
    const speed = g.param("Speed", { min: 0, max: 10, default: 1 });
    const width = g.param("Width", { min: 0, max: 1, default: 0.5 });

    const dry = g.input();
    // π·Width radians apart, as the plugin offsets its right channel: Width/2 of a cycle.
    const sweep = g.lfo("sine", speed, g.mul(width, 0.5));
    const half = g.mul(depth, 0.5);
    const timeMs = g.aadd(g.amul(sweep, half), g.add(20, half));
    // 45 ms ceiling: 20 ms of base and 20 of Depth, allocated once at prepare.
    // All wet: the blend is the engine's `@mix` around every module, which the chorus module sets to 0.5.
    g.output(g.delay(dry, timeMs, 45));
  });
}
