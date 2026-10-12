// peak.ts — a file's TRUE peak: the loudest sample on ANY channel, which is what a gain is set from.
// Not the sidecar's envelope, which is a mono SUM rounded to four decimals — a peak living on one
// channel reads up to 6 dB low there, and two channels in anti-phase read as silence. See docs/analysis.md.

import {
  type DecodeOptions,
  decodeFrames,
  type StreamFacts,
} from "./decode.ts";

/** The floor silence reports, and the `Peak` param's minimum: a silent file is a no-op, not -Infinity. */
export const PEAK_FLOOR_DB = -100;

export interface FilePeak extends StreamFacts {
  /** Linear, as measured: a float file over full scale is reported above 1, since rounding is the module's policy. */
  peak: number;
  peakDb: number;
}

/** dBFS of a linear magnitude, floored. */
export function toDb(linear: number): number {
  return linear > 0
    ? Math.max(PEAK_FLOOR_DB, 20 * Math.log10(linear))
    : PEAK_FLOOR_DB;
}

/** The largest magnitude across every channel of some interleaved frames. */
export function peakOfInterleaved(
  samples: Float32Array,
  count: number,
): number {
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Stream the file and keep only a running max: one block in memory however long the master is. */
export async function measureFilePeak(
  source: string,
  options: DecodeOptions = {},
): Promise<FilePeak> {
  let peak = 0;
  const facts = await decodeFrames(
    source,
    (samples, channels, frames) => {
      peak = Math.max(peak, peakOfInterleaved(samples, channels * frames));
    },
    options,
  );
  return { ...facts, peak, peakDb: toDb(peak) };
}
