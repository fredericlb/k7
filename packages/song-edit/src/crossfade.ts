// crossfade.ts — a CROSSFADE between two neighbouring events of a lane, planned: they are made to
// overlap by its length, and each fades over that overlap. The overlap comes from material the two do
// not play yet — B's start pulled earlier first, then A's end later — so a crossfade never changes
// what either plays outside it. No key of its own: the compiler tells it by its shape (compClips.ts).
// See packages/song/docs/takes.md.

/** One of the two events, as the compile resolved it: beats on the song, seconds in its file. */
export interface CrossfadeSide {
  start: number;
  length: number;
  /** The window it plays, seconds into its file; `to` absent is the file's end. */
  from: number;
  to?: number;
  /** How far its clip's own window reaches, seconds — the most a window may open to. */
  matFrom: number;
  matTo: number | null;
}

/** What to write: B's new start and window start, A's new window end (unchanged when absent), and the length that fit. */
export interface CrossfadePlan {
  bStart: number;
  bFrom: number;
  aTo?: number;
  length: number;
}

/** Make A and B overlap by `length` beats, B moving first — or null when there is no material to overlap with. */
export function planCrossfade(
  a: CrossfadeSide,
  b: CrossfadeSide,
  length: number,
  tempo: number,
): CrossfadePlan | null {
  const spb = 60 / tempo;
  const overlap = a.start + a.length - b.start;
  const need = length - overlap;
  let fromB = need;
  let fromA = 0;
  if (need > 0) {
    // B opens earlier as far as its clip reaches, then A opens later for the rest.
    const roomB = Math.max(0, (b.from - b.matFrom) / spb);
    fromB = Math.min(need, roomB);
    const aEnd = a.to ?? a.matTo;
    const roomA =
      a.matTo === null || aEnd === null
        ? 0
        : Math.max(0, (a.matTo - aEnd) / spb);
    fromA = Math.min(need - fromB, roomA);
  }
  const fit = overlap + fromB + fromA;
  if (!(fit > 1e-6)) return null;
  const aEnd = a.to ?? a.matTo;
  return {
    bStart: b.start - fromB,
    bFrom: b.from - fromB * spb,
    ...(fromA > 0 && aEnd !== null ? { aTo: aEnd + fromA * spb } : {}),
    length: fit,
  };
}
