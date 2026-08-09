// spectrumColour.ts — what colour a column of the waveform is, from what is IN it. No canvas
// and no React, so the part that decides what you SEE is testable. See ../docs/waveform.md.

/**
 * The three band colours, ADDITIVE — which is the whole trick.
 *
 * Bass is red, mids are green, highs are blue, and mixing them is ordinary light: bass over
 * mids gives yellow-orange, bass over highs gives purple, and all three together give white.
 * That is exactly the vocabulary a DJ player draws in, and it comes out of the arithmetic
 * rather than being a table of special cases somebody has to keep in step.
 *
 * The low is warmed towards orange and the high cooled towards violet, because pure red reads
 * as a warning and pure blue is hard to see. But each is kept LOW in the other two channels on
 * purpose: a first attempt gave the red and the blue a lot of green between them, and bass over
 * highs came out near-white instead of the purple it has to be. What a band contributes to the
 * two channels it does not own is what decides whether the blends land.
 */
export const BAND_COLOURS = {
  low: [255, 45, 10],
  mid: [90, 235, 80],
  high: [110, 80, 255],
} as const;

/** One column's three band peaks, 0..1. */
export interface Bands {
  low: number;
  mid: number;
  high: number;
}

/**
 * The colour of a column, as `rgb(...)`.
 *
 * NORMALISED by the loudest band, not by the sum. What a coloured waveform says is which band
 * DOMINATES here, and that has to read the same in a quiet passage as in a loud one — dividing
 * by the total would do that too, but scaling by the strongest is what keeps a column that is
 * all bass fully red instead of a third of the way to it.
 *
 * A silent column keeps the last hue rather than going black, because black is what the
 * background already is: `fallback` is what a caller draws when nothing is known at all.
 */
export function columnColour(b: Bands, fallback = "rgb(148,163,184)"): string {
  const top = Math.max(b.low, b.mid, b.high);
  if (!(top > 0)) return fallback;
  const l = b.low / top;
  const m = b.mid / top;
  const h = b.high / top;
  const mix = (i: 0 | 1 | 2) =>
    Math.min(
      255,
      Math.round(
        BAND_COLOURS.low[i] * l +
          BAND_COLOURS.mid[i] * m +
          BAND_COLOURS.high[i] * h,
      ),
    );
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** One column's bands, or null when this file was analysed before they existed. */
export function bandsAt(
  env: {
    low?: number[];
    mid?: number[];
    high?: number[];
  },
  i: number,
): Bands | null {
  const low = env.low?.[i];
  const mid = env.mid?.[i];
  const high = env.high?.[i];
  if (low === undefined || mid === undefined || high === undefined) return null;
  return { low, mid, high };
}
