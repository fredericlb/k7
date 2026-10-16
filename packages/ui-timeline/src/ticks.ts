// ticks.ts — choosing a ruler's unit for the zoom it is drawn at, which of its gridlines get a
// LABEL, and finding the tick a click landed on. Unit-free: `candidates` is what a scale may
// subdivide to — bars halve, seconds walk a 1/2/5/10 ladder. The timeline's ruler and the
// waveform's both read the labelling half, so they cannot disagree. Full rationale: docs/ticks.md.

/** The COARSEST candidate at least `minPx` apart: touching labels are unreadable, sparse ones are not. */
export function chooseTick(
  candidates: readonly number[],
  pxPerUnit: number,
  minPx = 56,
): number {
  for (const c of candidates) if (c * pxPerUnit >= minPx) return c;
  return candidates[candidates.length - 1] ?? 1;
}

/** A wall-clock ladder in seconds, NOT powers of two: bars halve and time does not — docs/ticks.md. */
export const SECOND_TICKS: readonly number[] = [
  0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** The frames a sub-second rung may span: a ladder of them puts every fine tick ON a frame. */
const FRAME_RUNGS = [1, 2, 5, 10, 15] as const;

/** The seconds ladder for a song that has a picture at `fps`: below a second it counts FRAMES, since a cut can only fall on one — docs/ticks.md. */
export function secondTicks(fps?: number): readonly number[] {
  if (!(fps && fps > 0)) return SECOND_TICKS;
  const frames = FRAME_RUNGS.map((n) => n / fps).filter((s) => s < 1 - 1e-9);
  return [...frames, ...SECOND_TICKS.filter((s) => s >= 1)];
}

/** A seconds tick's label: `m:ss` on whole seconds, and between them the FRAME it is when the ladder counts frames. */
export function formatSecondTick(
  sec: number,
  step: number,
  fps?: number,
): string {
  if (!(fps && fps > 0) || step >= 1) return formatClock(sec, step);
  const whole = Math.floor(sec + 1e-9);
  const frame = Math.round((sec - whole) * fps);
  return frame === 0 ? formatClock(whole, 1) : `${frame}f`;
}

/** `m:ss`, plus decimals only when the STEP needs them — a 30s ruler does not say "1:30.0". */
export function formatClock(sec: number, step = 1): string {
  const neg = sec < 0;
  // Two decimals below a tenth of a second, one below a second, none at or above it.
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  // Rounded BEFORE the split, so 59.7 reads 1:00 and never 0:60.
  const s = Math.round(Math.abs(sec) * 10 ** digits) / 10 ** digits;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const ss = rest.toFixed(digits).padStart(digits ? 3 + digits : 2, "0");
  return `${neg ? "-" : ""}${m}:${ss}`;
}

/** Every tick of `step` from 0 up to and including `end`. Empty for a non-positive step. */
export function ticksUpTo(end: number, step: number): number[] {
  if (!(step > 0) || !(end >= 0)) return [];
  const out: number[] = [];
  // Counted, not accumulated: adding 0.1 four hundred times lands at 40.000000000000255.
  for (let i = 0; i * step <= end + 1e-9; i++) out.push(i * step);
  return out;
}

/** The first tick strictly after (`dir` 1) or before (-1) `value` in an ascending list, or null past the end — what a step lands on. */
export function adjacentTick(
  ticks: readonly number[],
  value: number,
  dir: 1 | -1,
): number | null {
  // Strictly, by more than float noise, so a playhead already ON a tick moves off it.
  const eps = 1e-6;
  if (dir > 0) {
    for (const t of ticks) if (t > value + eps) return t;
    return null;
  }
  for (let i = ticks.length - 1; i >= 0; i--)
    if ((ticks[i] as number) < value - eps) return ticks[i] as number;
  return null;
}

/** The tick nearest `value`, or null when the nearest is further than `tolerance` away. */
export function nearestTick(
  ticks: readonly number[],
  value: number,
  tolerance = Number.POSITIVE_INFINITY,
): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of ticks) {
    const d = Math.abs(t - value);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best !== null && bestD <= tolerance ? best : null;
}

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
