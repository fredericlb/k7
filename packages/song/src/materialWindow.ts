// materialWindow.ts — turn a DAW's (start, length, offset, loop region) into this project's
// model: a WINDOW that belongs to the material and a COUNT that belongs to the placement.
// One rule, shared by the importer and by any migration, so both land on the same numbers.

/** What a foreign DAW says about one placed clip. Everything in beats. */
export interface PlacedExtent {
  length: number;
  offset?: number; // audio: source in-point; midi: playStart
  loopStart?: number;
  loopEnd?: number;
}

/** What this project says instead: a slice of the material, played `loops` times. */
export interface MaterialWindow {
  from: number;
  to: number;
  loops: number;
}

// A length is "a whole number of loops" up to this, in beats — a hair under a 1/64 note at any tempo. Imported
// numbers are rounded decimals, so 8 bars of a 26.38-beat region is never exactly 4 × 26.38.
const EPS = 1e-6;

/**
 * The window, and how many times it is played.
 *
 * A looped clip that is a WHOLE number of loops long is exactly "this region, N times" — that is the case worth
 * recognising, and it is the one that carries the intent: the length was a consequence of the repeat, not a
 * decision. Everything else — no loop region, or a length that cuts one short — is one pass of a window that
 * runs from where playback starts to where the clip ends. A region longer than the length never comes round, so
 * calling it a single pass loses nothing.
 */
export function materialWindow(p: PlacedExtent): MaterialWindow {
  const loopStart = p.loopStart ?? 0;
  const region = (p.loopEnd ?? 0) - loopStart;
  if (region > EPS && p.length >= region - EPS) {
    const n = p.length / region;
    const whole = Math.round(n);
    if (whole >= 1 && Math.abs(n - whole) * region < EPS)
      return { from: loopStart, to: loopStart + region, loops: whole };
  }
  const from = region > EPS ? loopStart : (p.offset ?? 0);
  return { from, to: from + p.length, loops: 1 };
}
