// seriesColors.ts — the ONE palette for things told apart by their order rather than their kind:
// takes, a rack's slices, a deck's cue buttons. Tracks are not among them: a track is coloured by
// its category (trackColor.ts). Twelve hues at one lightness and chroma, so none shouts over the
// others, walked with a stride so neighbours are far apart. See ../docs/trackColor.md.

/** OKLCH(0.68 0.13 h) for h = 25, 55 … 355, in hue order — every one at 6:1 or better on the app's ground. */
export const SERIES_COLORS = [
  "#dd766f",
  "#d58042",
  "#bd9121",
  "#96a136",
  "#60ad64",
  "#00b294",
  "#00aebe",
  "#2ea4dc",
  "#7195e8",
  "#9e87e0",
  "#c07bc4",
  "#d6749c",
] as const;

/** Coprime with 12, so the walk visits every hue once before repeating, each step 150° from the last. */
const STRIDE = 5;

/** The colour of the i-th item of a series — the same i, the same colour, in every view. */
export const seriesColor = (i: number): string => {
  const n = SERIES_COLORS.length;
  return SERIES_COLORS[(((i * STRIDE) % n) + n) % n];
};
