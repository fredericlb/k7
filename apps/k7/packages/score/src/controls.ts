// The score toolbar's arithmetic: how far a transposition may go, the zoom steps, and how a
// shift in semitones reads. Pure, so it is tested without a DOM — ../../../docs/score.md.

export const TRANSPOSE_MIN = -12;
export const TRANSPOSE_MAX = 12;

/** A transposition kept within an octave either way. */
export function clampTranspose(n: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, Math.round(n)));
}

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** The next zoom step in a direction, staying on the ladder even from a value off it. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0)
    return (
      ZOOM_STEPS.find((s) => s > current + 1e-9) ??
      ZOOM_STEPS[ZOOM_STEPS.length - 1]
    );
  return (
    [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-9) ?? ZOOM_STEPS[0]
  );
}

/** A shift as a musician reads it: `0`, `♯2`, `♭3`. */
export function formatTranspose(n: number): string {
  return n === 0 ? "0" : `${n > 0 ? "♯" : "♭"}${Math.abs(n)}`;
}
