// A phaser — Tracktion's, rebuilt as a graph so its knobs can be AUTOMATED: the plugin keeps them as
// plain state, which a curve cannot reach. Four all-pass stages, their corner swept from 100 Hz up
// `Depth` octaves and back once per 1/`Rate` seconds, the last stage fed back by `Feedback` and summed
// with the dry signal. Same names, ranges and defaults as the plugin, so a node's values carry over.

import { type GraphJson, graph } from "./index";

export function phaser(): GraphJson {
  return graph((g) => {
    const depth = g.param("Depth", { min: 0, max: 10, default: 5 });
    const rate = g.param("Rate", { min: 0, max: 10, default: 0.4 });
    const feedback = g.param("Feedback", { min: 0, max: 1, default: 0.7 });

    const dry = g.input();
    // A triangle, 0..1, times Depth: the plugin's sweep is even in PITCH, so it is octaves that move linearly.
    const tri = g.lfo("triangle", rate);
    const octaves = g.amul(g.aadd(g.amul(tri, 0.5), 0.5), depth);

    // Read before the last stage writes it, so it is that stage's PREVIOUS sample — the plugin's feedback tap.
    const fb = g.wire("fb");
    let x = g.aadd(dry, g.amul(fb, feedback));
    for (let i = 0; i < 3; i++) x = g.allpass(x, 100, octaves);
    g.allpass(x, 100, octaves, fb);
    g.output(g.aadd(dry, fb));
  });
}
