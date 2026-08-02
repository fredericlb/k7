// ticks.ts — how many gridlines to LABEL when they get too close together.
//
// A time ruler keeps drawing its lines as you zoom out, but the numbers on them stop
// being readable long before the lines do: at 6px apart "17" and "18" overlap into a
// smear. Thinning is by halving — label every 2nd, then every 4th, every 8th — because
// the labels that survive are then always the round ones (bars 1, 5, 9… not 1, 4, 7),
// which is what makes a ruler scannable.
//
// Lives here rather than in either caller because the waveform's ruler and the timeline's
// have to agree: they sit one above the other in the clip editor, and two different
// thinning rules would put a label on one and not the other at the same zoom.

/** The minimum gap, in px, between two labels before they read as one smear. */
export const MIN_LABEL_PX = 10;

/**
 * Label every Nth gridline, N a power of two, so that labels are at least `minPx` apart.
 * `spacingPx` is the distance between ADJACENT gridlines.
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
