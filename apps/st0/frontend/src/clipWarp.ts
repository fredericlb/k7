// clipWarp.ts — turning a gesture on the waveform into a `clip warp` line.
//
// The picture is drawn in REGION seconds and the command speaks two other units: a moment of the
// SOURCE file, and the BEAT that moment should land on. Both conversions live here, pure, because
// getting one of them backwards puts a stretch point somewhere the drawing never showed and
// nothing on screen says so — the picture would be redrawn from the file and simply be right
// about the wrong point.

/** The linear file↔display mapping, as `WebWaveform.sourceMap` sends it. */
export interface SourceMap {
  inPoint: number;
  stretch: number;
}

/**
 * A region second → the second of the SOURCE FILE drawn there.
 *
 * The inverse of the producer's `toDisplay` — `display = (file − inPoint) × stretch` — applied
 * rather than reinvented. A stretch of 0 would be a picture of nothing; it is refused by falling
 * back to 1 so the gesture lands on the file's own rate instead of at infinity.
 */
export function toFileSec(displaySec: number, map: SourceMap): number {
  const rate = map.stretch > 0 ? map.stretch : 1;
  return displaySec / rate + map.inPoint;
}

/**
 * A region second → the BEAT the grid has there.
 *
 * `target` in a warp mark is `(beat * 60) / tempo`, so this is that read backwards and it is the
 * only reason the browser can name a beat at all. Beats are counted from the clip's start, which
 * is where the region's zero is.
 */
export function toClipBeat(displaySec: number, tempo: number): number {
  return tempo > 0 ? (displaySec * tempo) / 60 : 0;
}

/**
 * The line that pins the source moment under `atSec` to the beat under `toSec`.
 *
 * One verb places a point and moves one — `commands.yaml` says why: from the waveform they are one
 * gesture, and whether a point was already there is not something you decide beforehand. So a
 * double-click (which passes the same second twice, pinning a moment to where it already is) and
 * a drag (which passes two) produce the same command.
 *
 * Four decimals on the second and three on the beat: the second addresses a point that already
 * exists — `setWarpPoint` matches on it — so it has to round-trip, while the beat is only ever a
 * destination.
 */
/**
 * The stretch point under `displaySec`, within `withinPx` of it — or null.
 *
 * There WAS one of these, removed two commits ago because the drag ended up on DOM handles and
 * nothing called it. It is back because a DOUBLE-CLICK has to decide between two acts on one
 * gesture — place a point, or drop the one you double-clicked — and only a hit test can tell them
 * apart. Written down rather than quietly restored: a function that comes back is worth as much
 * of a note as one that goes.
 *
 * By `orig`, which is where the point is DRAWN. Now that the picture is warped that is also where
 * it lands, so the two readings have stopped disagreeing — but `orig` stays the one asked for,
 * because it is the position a hand is pointing at whatever the picture is doing.
 *
 * In PIXELS rather than seconds, so the grab zone is the same size at every zoom.
 */
export function warpAt<T extends { orig: number }>(
  marks: readonly T[],
  displaySec: number,
  pxPerSec: number,
  withinPx = 8,
): T | null {
  let best: T | null = null;
  let bestPx = withinPx;
  for (const m of marks) {
    const px = Math.abs(m.orig - displaySec) * pxPerSec;
    if (px <= bestPx) {
      best = m;
      bestPx = px;
    }
  }
  return best;
}

/** Drop the point that pins `src`. One verb per act: placing and removing are not one gesture. */
export function warpRemoveLine(clip: string, src: number): string {
  return `clip warp remove ${clip} ${src.toFixed(4)}`;
}

export function warpLine(
  clip: string,
  atSec: number,
  toSec: number,
  map: SourceMap,
  tempo: number,
): string {
  const src = Math.max(0, toFileSec(atSec, map));
  const beat = Math.max(0, toClipBeat(toSec, tempo));
  return `clip warp ${clip} ${src.toFixed(4)} ${beat.toFixed(3)}`;
}
