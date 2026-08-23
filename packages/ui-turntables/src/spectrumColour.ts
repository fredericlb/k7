// spectrumColour.ts — what colour a column of the waveform is, from what is IN it. No canvas
// and no React, so the part that decides what you SEE is testable. See ../docs/waveform.md.

/** The three band colours, ADDITIVE, each kept LOW in the two channels it does not own — ../docs/waveform.md. */
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

/** The colour of a column — NORMALISED by the loudest band and not the sum, so pure bass stays pure red. */
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
