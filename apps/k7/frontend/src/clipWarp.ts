// clipWarp.ts — turning a gesture on the waveform into a `clip warp` line.
//
// The picture is drawn in REGION seconds and the command speaks two other units: a moment of the
// SOURCE file, and the BEAT that moment should land on. Both conversions live here, pure, because
// getting one of them backwards puts a stretch point somewhere the drawing never showed and
// nothing on screen says so — the picture is redrawn from the file and is simply right about the
// wrong point. Which is exactly what happened; see `toFileSec`.

/** The file↔display mapping's constants, as `WebWaveform.sourceMap` sends them. */
export interface SourceMap {
  /** The file second the region's zero shows. */
  inPoint: number;
  /** Timeline seconds per source second, over the WHOLE clip — the map's overall ratio. */
  stretch: number;
  /** The map beat the region's zero sits on, which the producer subtracts to make display 0 the clip's start. */
  zeroBeat: number;
}

/** One point of the map, in both spaces — `WebWaveform.warpMarks`. */
export interface WarpPoint {
  /** Display seconds: where the moment is drawn (and, the picture being warped, where it lands). */
  orig: number;
  /** The FILE second it pins. */
  src: number;
}

/** A region second → the second of the SOURCE FILE drawn there — PIECEWISE, because the picture is, and the overall ratio is only its inverse when straight. */
export function toFileSec(
  displaySec: number,
  map: SourceMap,
  marks: readonly WarpPoint[] = [],
): number {
  const rate = map.stretch > 0 ? map.stretch : 1;
  const pts = [...marks].sort((a, b) => a.orig - b.orig);
  if (pts.length < 2) return displaySec / rate + map.inPoint;
  const seg = (i: number): number => {
    const a = pts[i];
    const b = pts[i + 1];
    const d = b.orig - a.orig;
    return d > 0
      ? a.src + ((displaySec - a.orig) / d) * (b.src - a.src)
      : a.src;
  };
  if (displaySec <= pts[0].orig) return seg(0);
  for (let i = 0; i + 1 < pts.length; i++)
    if (displaySec <= pts[i + 1].orig) return seg(i);
  return seg(pts.length - 2);
}

/** A region second → the BEAT of the map that lands there — `zeroBeat` is not decoration: the map counts from the FILE's start, the region from the in-point. */
export function toClipBeat(
  displaySec: number,
  tempo: number,
  map: SourceMap,
): number {
  return tempo > 0 ? map.zeroBeat + (displaySec * tempo) / 60 : map.zeroBeat;
}

/** The line that pins the source moment under `atSec` to the beat under `toSec` — one verb for the double-click and the drag alike. */
export function warpLine(
  clip: string,
  atSec: number,
  toSec: number,
  map: SourceMap,
  tempo: number,
  marks: readonly WarpPoint[] = [],
): string {
  const src = Math.max(0, toFileSec(atSec, map, marks));
  const beat = Math.max(0, toClipBeat(toSec, tempo, map));
  return `clip warp ${clip} ${src.toFixed(4)} ${beat.toFixed(3)}`;
}

// Removing a warp point is the RIGHT-CLICK menu's, where the pointer is already on the handle, so no hit test belongs here.
