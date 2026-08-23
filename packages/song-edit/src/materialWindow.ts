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

// A length is "a whole number of loops" up to this — imported numbers are rounded decimals.
const EPS = 1e-6;

/** The window and how many times it is played — a WHOLE number of loops is "this region, N times". */
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
