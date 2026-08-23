// ticks.ts — how many gridlines to LABEL when they get too close together, and which
// unit a ruler draws. Thinning is by halving, so the labels that survive are the round
// ones (bars 1, 5, 9… not 1, 4, 7), which is what makes a ruler scannable. It lives here
// rather than in either caller because the waveform's ruler and the timeline's have to
// agree — see docs/ticks.md for why, and for where the widths come from.

/** The floor under any label spacing — what a single-character label needs. */
export const MIN_LABEL_PX = 10;

/** Advance of one character at the 12px monospace the timeline's ruler labels in. */
export const MONO_CHAR_PX = 7.2;

/** Clear space between one label's last character and the next label's first. */
export const LABEL_GAP_PX = 8;

/**
 * How far apart two gridlines must be for `widest` to fit between them: the label's own
 * width plus a gap. Pass the WIDEST label the ruler can print, not the widest currently on
 * screen, or panning across bar 10 or bar 100 would re-thin the whole ruler under you.
 *
 * Estimated from the character count rather than measured. Both rulers label in digits and
 * dots, which are single-advance in a monospace, so the count IS the width — and the
 * timeline draws DOM, where measuring means a layout per frame. The 12px monospace is the
 * wider of the two rulers' fonts, so the waveform's 10px sans-serif is covered by the same
 * number, which is what keeps the two agreeing when stacked. See docs/ticks.md.
 */
export function labelMinPx(widest: string, charPx = MONO_CHAR_PX): number {
  return Math.max(MIN_LABEL_PX, widest.length * charPx + LABEL_GAP_PX);
}

/**
 * Label every Nth gridline, N a power of two, so that labels are at least `minPx` apart.
 * `spacingPx` is the distance between ADJACENT gridlines.
 *
 * `minPx` defaults to the floor, which only suits a one-character label — every caller
 * with real labels passes `labelMinPx(widest)`, because "129" needs three times that.
 *
 * Returns 1 when they already fit. Non-finite or non-positive spacing (a zero-width pane
 * mid-layout, a degenerate zoom) yields 1 as well: the caller draws what it has rather
 * than dividing by nothing.
 */
export function labelStride(spacingPx: number, minPx = MIN_LABEL_PX): number {
  if (!Number.isFinite(spacingPx) || spacingPx <= 0) return 1;
  let stride = 1;
  // Doubling rather than computing a log: the count is tiny, and this can't land off by
  // one at a power-of-two boundary the way ceil(log2(x)) does for exact values.
  while (spacingPx * stride < minPx) stride *= 2;
  return stride;
}

/**
 * Whether the gridline at `index` keeps its label. Indices are counted from the ruler's
 * ORIGIN, not from the first visible line — otherwise scrolling would make labels appear
 * and disappear as the leading line changed parity.
 */
export function labelled(index: number, stride: number): boolean {
  return stride <= 1 || index % stride === 0;
}

/**
 * The tick nearest `v`, or null when the ruler drew none.
 *
 * What a click on a ruler snaps to. Deliberately the drawn LIST rather than a round-to-the-
 * unit: a ruler that starts mid-bar has no origin to round from, and the waveform's grid is
 * handed to it line by line with no stride at all. Both rulers pass the array they just
 * drew, so what you land on is always something you can see.
 *
 * Order-independent — the callers' lists happen to ascend, but nothing here needs them to.
 */
export function nearestTick(ticks: number[], v: number): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of ticks) {
    const d = Math.abs(t - v);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Above this, a column is wide enough to hold the next unit down inside it. */
export const MAX_COLUMN_PX = 50;

/**
 * The unit a ruler should draw, in BEATS, given how wide a bar currently is.
 *
 * The ladder is musical, not binary: a bar descends to its BEAT (a division by the time
 * signature's numerator — four quarters in 4/4, not two halves), and only below the beat
 * does it halve — eighth, sixteenth, and so on. Dividing a 4/4 bar by two would draw a
 * half-note line, which is not a thing a ruler marks.
 *
 * Floors at a 64th of a beat: past that the lines are closer than the pixels, and the
 * loop would spin looking for a width that cannot exist.
 */
export function subdivideBeats(
  barBeats: number,
  ppb: number,
  maxPx = MAX_COLUMN_PX,
): number {
  if (
    !Number.isFinite(ppb) ||
    ppb <= 0 ||
    !Number.isFinite(barBeats) ||
    barBeats <= 0
  )
    return Math.max(1, barBeats || 1);
  if (barBeats * ppb <= maxPx) return barBeats; // the bar still fits — draw bars
  let unit = 1; // one beat: the quarter in x/4
  const floor = 1 / 64;
  while (unit * ppb > maxPx && unit > floor) unit /= 2;
  return unit;
}

/** The finest split of one column this will make — a 16th of the interval it is handed. */
export const MAX_GRID_SPLIT = 16;

/**
 * The EXTRA lines to draw between the ticks a ruler was handed, when its columns have opened up.
 *
 * `subdivideBeats` answers the same question for a ruler that knows its unit and can compute any
 * tick it likes. This is for the other kind — the waveform, handed a bar/beat list by the file
 * service, which cannot ask for a finer one: the sub-beat times simply are not in the data, so
 * the only thing it can do is SPLIT what it has. Same halving rule, same `MAX_COLUMN_PX`, so the
 * two produce the same density at the same zoom and the ruler over the wave agrees with it.
 *
 * Split per PAIR rather than once for the list: a warped clip's beats are not evenly spaced on
 * screen, and one split count for all of them would crowd the compressed passages while leaving
 * the stretched ones bare. Interpolating linearly inside a pair is exact for the same reason the
 * projection is — it is piecewise-linear between the marks, and these ARE the marks.
 *
 * Returns times, not counts, because that is what both callers want: the canvas draws them and
 * the click snaps to them (`nearestTick`), which is what keeps "you can only land on a line that
 * is on screen" true once there are more lines than the service sent.
 */
export function subdivideGrid(
  times: number[],
  pxPerSec: number,
  maxPx = MAX_COLUMN_PX,
): number[] {
  const out: number[] = [];
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return out;
  for (let i = 0; i + 1 < times.length; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    const gap = (t1 - t0) * pxPerSec;
    if (!(gap > maxPx)) continue;
    let n = 2;
    while (gap / n > maxPx && n < MAX_GRID_SPLIT) n *= 2;
    for (let j = 1; j < n; j++) out.push(t0 + ((t1 - t0) * j) / n);
  }
  return out;
}
