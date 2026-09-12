// Tremolo — amplitude modulated by an LFO. The oldest effect there is, and the one that shows
// why the LFO runs at SAMPLE rate: a block-rate gain stepped 5 times a second is a stutter, not
// a tremolo. See ../docs/catalogue.md.

import { type GraphJson, graph } from "./index";

/** The reference tremolo. `Depth` at 0 is a true bypass, which is what makes it safe to leave in a chain. */
export function tremolo(): GraphJson {
  return graph((g) => {
    const rate = g.param("Rate", { min: 0.1, max: 20, default: 5 });
    const depth = g.param("Depth", { min: 0, max: 1, default: 0.5 });

    const dry = g.input();
    // The LFO is bipolar; the gain wants 0..1, so it is halved and offset before anything scales it.
    const unipolar = g.amul(g.aadd(g.lfo("sine", rate), 1), 0.5);
    // gain = (1 - depth) + depth * unipolar — the floor rises as depth falls, so depth 0 is unity.
    const amount = g.aadd(g.amul(unipolar, depth), g.sub(1, depth));
    g.output(g.amul(dry, amount));
  });
}
