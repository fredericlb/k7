// ticks.ts — choosing a ruler's unit for the zoom it is drawn at, and finding the tick a
// click landed on. Unit-free: `candidates` is what a scale is allowed to subdivide to, and
// that is where the two READINGS of one ruler differ — bars halve, and seconds walk a
// 1/2/5/10 decimal ladder. Full rationale: docs/ticks.md.

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
  // Counted, not accumulated: adding 0.1 four hundred times lands at 40.000000000000255.
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
