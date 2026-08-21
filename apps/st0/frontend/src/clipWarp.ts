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

/**
 * A region second → the second of the SOURCE FILE drawn there.
 *
 * **PIECEWISE, because the picture is.** This read `display / stretch + inPoint` — the overall
 * ratio — which is the inverse of the drawing only while the map is a straight line. With two
 * markers it is one, so a first stretch point landed where it was dropped; from the third on it
 * is not, and the point went to a source second the picture never showed there. The map then
 * genuinely bent, so the waveform changed under a gesture that was supposed to pin a moment
 * where it already was. That is "I add a second point and the waveform changes".
 *
 * The marks carry the map in BOTH spaces already (`orig` display, `src` file), so this walks them
 * rather than rebuilding anything. Outside them — and with fewer than two, which is a clip whose
 * map states no rate — the overall ratio is the honest answer and the old one.
 */
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

/**
 * A region second → the BEAT of the map that lands there.
 *
 * `target` in a warp mark is `(beat − zeroBeat) × 60 / tempo`, so this is that read backwards.
 * `zeroBeat` is not decoration: the map's beats are counted from the FILE's start while the
 * region's zero is the clip's IN-POINT, and the two differ by exactly that on any trimmed clip —
 * which is most of the clips anyone warps.
 */
export function toClipBeat(
  displaySec: number,
  tempo: number,
  map: SourceMap,
): number {
  return tempo > 0 ? map.zeroBeat + (displaySec * tempo) / 60 : map.zeroBeat;
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

// A `warpAt` hit test lived here twice — once for a drag that went to DOM handles instead, once
// for a double-click that removed a point. Removing moved to the RIGHT-CLICK menu, where the
// pointer is already on the handle and there is nothing to search for. Twice written, twice
// unneeded: what kept asking for it was a gesture looking for the wrong owner.
