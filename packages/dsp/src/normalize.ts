// Normalisation — bring a recording's loudest sample to a chosen level. The first COLD module:
// it works only on an input that is already on disk, because the gain it applies cannot be known
// until the whole file has been read. See @studio/song's docs/coldModules.md.

import { type GraphJson, graph } from "./index";

/** Where the peak is put, by default: 1 dB of headroom, the usual answer for a master. */
export const DEFAULT_TARGET_DB = -1;

/** Peak normalisation. The graph is trivial and that is the point — see ../docs/catalogue.md. */
export function normalize(): GraphJson {
  return graph((g) => {
    const target = g.param("Target", {
      min: -60,
      max: 0,
      default: DEFAULT_TARGET_DB,
    });

    // The WHOLE input's peak in dBFS, written by the cold pass; 0 by default, so it only attenuates.
    const peak = g.param("Peak", { min: -100, max: 0, default: 0 });

    // Clamped: near silence measures -100 dBFS and would otherwise ask for +99 dB.
    const gainDb = g.clamp(g.sub(target, peak), -60, 30);
    g.gain(g.fromdb(gainDb));
  });
}
