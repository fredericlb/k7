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

/** How far apart two gridlines must be for `widest` to fit: pass the widest the ruler CAN print, estimated — docs/ticks.md. */
export function labelMinPx(widest: string, charPx = MONO_CHAR_PX): number {
  return Math.max(MIN_LABEL_PX, widest.length * charPx + LABEL_GAP_PX);
}

/** Label every Nth gridline, N a power of two, so labels sit at least `minPx` apart; 1 when they already fit. */
export function labelStride(spacingPx: number, minPx = MIN_LABEL_PX): number {
  if (!Number.isFinite(spacingPx) || spacingPx <= 0) return 1;
  let stride = 1;
  // Doubling rather than a log, which lands off by one at a power-of-two boundary for exact values.
  while (spacingPx * stride < minPx) stride *= 2;
  return stride;
}

/** Whether the gridline at `index` keeps its label; indices count from the ruler's ORIGIN, so panning cannot re-thin it. */
export function labelled(index: number, stride: number): boolean {
  return stride <= 1 || index % stride === 0;
}

/** The tick nearest `v`, or null when the ruler drew none: a click snaps to the drawn LIST — see docs/ticks.md. */
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

/** The unit a ruler should draw, in BEATS: a musical ladder rather than a binary one, floored at a 64th — docs/ticks.md. */
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

/** The EXTRA times between the ticks a ruler was handed, split per PAIR once its columns open up — see docs/ticks.md. */
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
