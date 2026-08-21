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
// A `warpAt` hit test lived here twice — once for a drag that went to DOM handles instead, once
// for a double-click that removed a point. Removing moved to the RIGHT-CLICK menu, where the
// pointer is already on the handle and there is nothing to search for. Twice written, twice
// unneeded: what kept asking for it was a gesture looking for the wrong owner.

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
