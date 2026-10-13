// Chorus — the DSP itself, as a description the engine runs. Edit this file and the module changes; the
// .json beside it is the build, regenerated whenever this is newer.
//
// The builder ARRIVES as the argument, so nothing is imported at runtime and this folder needs no node_modules.
// Tracktion's chorus, number for number: its knobs are plain plugin state, so a curve could never move them.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
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
};
