// ticks.ts — choosing a ruler's unit for the zoom it is drawn at, and finding the tick a
// click landed on. Unit-free: `candidates` is what a scale is allowed to subdivide to, and
// that is where the two READINGS of one ruler differ — bars halve, and seconds walk a
// 1/2/5/10 decimal ladder. Full rationale: docs/ticks.md.

/**
 * The coarsest candidate whose ticks are at least `minPx` apart, at `pxPerUnit`.
 *
 * Coarsest and not finest: a ruler is unreadable when its labels touch, and legible when they
 * are merely sparse. `candidates` must be sorted ascending; the finest is returned when even
 * it is too wide, so this never fails to answer.
 */
export function chooseTick(
  candidates: readonly number[],
  pxPerUnit: number,
  minPx = 56,
): number {
  for (const c of candidates) if (c * pxPerUnit >= minPx) return c;
  return candidates[candidates.length - 1] ?? 1;
}

/**
 * A wall-clock ruler's ladder, in seconds — 1/2/5/10 per decade, plus the minute steps a
 * viewer actually reads (15s, 30s, 1m, 2m, 5m…).
 *
 * Not powers of two, which is what a musical ruler uses: bars halve, and time does not. A
 * 0.25s step is a legitimate zoom on a cut, but `16s` between labels is not a thing anyone
 * reads a duration in.
 */
export const SECOND_TICKS: readonly number[] = [
  0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** `m:ss`, plus decimals only when the STEP needs them — a 30s ruler does not say "1:30.0". */
export function formatClock(sec: number, step = 1): string {
  const neg = sec < 0;
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  // Two decimals below a tenth of a second, one below a second, none at or above it.
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const ss = rest.toFixed(digits).padStart(digits ? 3 + digits : 2, "0");
  return `${neg ? "-" : ""}${m}:${ss}`;
}

/** Every tick of `step` from 0 up to and including `end`. Empty for a non-positive step. */
export function ticksUpTo(end: number, step: number): number[] {
  if (!(step > 0) || !(end >= 0)) return [];
  const out: number[] = [];
  // Counted rather than accumulated: adding 0.1 four hundred times lands at 40.000000000000255,
  // and a ruler whose labels are one ulp off its grid lines is a bug you find with a screenshot.
  for (let i = 0; i * step <= end + 1e-9; i++) out.push(i * step);
  return out;
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
