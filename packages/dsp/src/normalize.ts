// Normalisation — bring a recording's loudest sample to a chosen level. The first COLD module:
// it works only on an input that is already on disk, because the gain it applies cannot be known
// until the whole file has been read. See @studio/song's docs/coldModules.md.

import { type GraphJson, graph } from "./index";

/** Where the peak is put, by default: 1 dB of headroom, the usual answer for a master. */
export const DEFAULT_TARGET_DB = -1;

/**
 * Peak normalisation, as a graph.
 *
 * **The graph is trivial, and that is the whole point.** Applying the gain is one node; knowing
 * WHICH gain is the hard part, and no per-block graph can answer it — a streaming node sees the
 * samples it has, and the loudest one may be the last. So the measurement is not here: `Peak` is
 * an input to this graph, filled in by the cold pass that reads the file end to end, and what is
 * left to describe is the arithmetic.
 *
 * That is exactly what makes the module cold rather than merely expensive: it is not that
 * measuring costs too much to do live, it is that live there is nothing to measure yet.
 */
export function normalize(): GraphJson {
  return graph((g) => {
    const target = g.param("Target", {
      min: -60,
      max: 0,
      default: DEFAULT_TARGET_DB,
    });

    // The measured peak of the WHOLE input, in dBFS, written by the analysis pass. A parameter
    // because that is how a measured fact reaches a graph — same shape as a knob, different
    // author. Its default is 0 dBFS: with no pass having run, the gain is `Target` and the
    // module simply attenuates, which is the harmless direction to be wrong in.
    const peak = g.param("Peak", { min: -100, max: 0, default: 0 });

    // Clamped, because the arithmetic has one degenerate case with a very loud answer: near
    // silence measures -100 dBFS and would ask for +99 dB, turning a hiss into a full-scale
    // roar. +30 is generous for anything worth normalising and finite for everything else.
    const gainDb = g.clamp(g.sub(target, peak), -60, 30);
    g.gain(g.fromdb(gainDb));
  });
}
