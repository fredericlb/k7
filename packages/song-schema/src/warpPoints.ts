// warpPoints.ts — placing, moving and removing the points of a clip's stretch map. Pure array work
// over `[timelineBeat, sourceSecond]` pairs, so the rule that matters — the map stays monotonic —
// is decided in one place and tested without a file. Full rationale: docs/warp.md.

/** One point of the map: where a moment of the SOURCE lands on the timeline. */
export type WarpMarker = [beat: number, sec: number];

/** A clip's stretch map as the compiled document carries it. */
export interface ClipWarp {
  algorithm: string;
  markers: WarpMarker[];
}

/** The map a clip FILE declares, and whether the file declines it — answered apart, see docs/warpPoints.md. */
export function readClipWarp(
  raw:
    | { algorithm?: unknown; markers?: unknown; disable?: unknown }
    | undefined,
): { map?: ClipWarp; declined: boolean } {
  const m = raw?.markers;
  const map =
    Array.isArray(m) && m.length >= 2
      ? {
          algorithm: String(raw?.algorithm ?? "elastique"),
          markers: m.map((p): WarpMarker => [Number(p[0]), Number(p[1])]),
        }
      : undefined;
  return { map, declined: raw?.disable === true };
}

/** The timeline BEAT a source second lands on, segment by segment and extrapolating past the ends (docs/warpPoints.md). */
export function beatAtSource(
  markers: readonly WarpMarker[],
  sec: number,
): number {
  if (markers.length < 2) return sec;
  const seg = (i: number): number => {
    const [b0, s0] = markers[i];
    const [b1, s1] = markers[i + 1];
    const d = s1 - s0;
    return d > 0 ? b0 + ((sec - s0) / d) * (b1 - b0) : b0;
  };
  if (sec <= markers[0][1]) return seg(0);
  for (let i = 0; i + 1 < markers.length; i++)
    if (sec <= markers[i + 1][1]) return seg(i);
  return seg(markers.length - 2);
}

/** …and back: the source second that lands on `beat`. The inverse of the above, segment for segment. */
export function sourceAtBeat(
  markers: readonly WarpMarker[],
  beat: number,
): number {
  if (markers.length < 2) return beat;
  const seg = (i: number): number => {
    const [b0, s0] = markers[i];
    const [b1, s1] = markers[i + 1];
    const d = b1 - b0;
    return d > 0 ? s0 + ((beat - b0) / d) * (s1 - s0) : s0;
  };
  if (beat <= markers[0][0]) return seg(0);
  for (let i = 0; i + 1 < markers.length; i++)
    if (beat <= markers[i + 1][0]) return seg(i);
  return seg(markers.length - 2);
}

/** How close two source seconds have to be to mean the same point — a millisecond survives a round trip. */
const SAME_SEC = 1e-3;

/** Move the point at `sec` to `beat`, or place one there — NEIGHBOURS STAY PUT, see docs/warpPoints.md. */
export function setWarpPoint(
  markers: readonly WarpMarker[],
  sec: number,
  beat: number,
): WarpMarker[] {
  const at = markers.findIndex((m) => Math.abs(m[1] - sec) <= SAME_SEC);
  const out: WarpMarker[] = markers.map((m) => [m[0], m[1]]);
  if (at >= 0) out[at] = [beat, out[at][1]];
  else {
    // Where it belongs by SOURCE second — the axis a click on the waveform names.
    const i = out.findIndex((m) => m[1] > sec);
    out.splice(i < 0 ? out.length : i, 0, [beat, sec]);
  }
  const bad = firstNonMonotonic(out);
  if (bad) throw new Error(bad);
  return out;
}

/** Drop the point at `sec`, refusing to go below two — one point states no rate (docs/warpPoints.md). */
export function removeWarpPoint(
  markers: readonly WarpMarker[],
  sec: number,
): WarpMarker[] {
  const at = markers.findIndex((m) => Math.abs(m[1] - sec) <= SAME_SEC);
  if (at < 0) throw new Error(`no warp point at ${sec}s`);
  if (markers.length <= 2)
    throw new Error(
      "a stretch map needs two points — remove the whole `warp:` block instead",
    );
  return markers.filter((_, i) => i !== at).map((m) => [m[0], m[1]]);
}

/** The two anchors a clip gets when it has no map yet — an identity map the engine SKIPS (docs/warpPoints.md). */
export function seedWarp(beats: number, seconds: number): WarpMarker[] {
  if (!(beats > 0) || !(seconds > 0))
    throw new Error("a clip needs a length in beats and in seconds to stretch");
  return [
    [0, 0],
    [beats, seconds],
  ];
}

/** The map, made to describe a source of `seconds` again after a bounce — null when nothing moves (docs/warpPoints.md). */
export function retimeWarpMarkers(
  markers: readonly WarpMarker[],
  seconds: number,
): WarpMarker[] | null {
  if (markers.length < 2 || !(seconds > 0)) return null;
  const first = markers[0];
  const last = markers[markers.length - 1];
  const srcSpan = last[1] - first[1];
  const beatSpan = last[0] - first[0];
  if (!(srcSpan > 0) || !(beatSpan > 0)) return null;
  // Already describes this file: a millisecond either way is the same end (docs/warpPoints.md).
  if (Math.abs(last[1] - seconds) <= SAME_SEC) return null;

  const rate = beatSpan / srcSpan; // beats per source second, over the whole map
  const kept = markers.filter((m) => m[1] < seconds - SAME_SEC);
  // The first point is the anchor and stays whatever the new length is (docs/warpPoints.md).
  if (kept.length === 0) kept.push([first[0], first[1]]);
  const at = kept[kept.length - 1];
  const out: WarpMarker[] = kept.map((m): WarpMarker => [m[0], m[1]]);
  // Six decimals, what every marker an importer writes already carries — a file a person reads.
  out.push([round6(at[0] + (seconds - at[1]) * rate), round6(seconds)]);
  return out.length >= 2 ? out : null;
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The complaint about the first pair that is out of order, or null — both axes must rise (docs/warpPoints.md). */
function firstNonMonotonic(m: readonly WarpMarker[]): string | null {
  for (let i = 1; i < m.length; i++) {
    if (m[i][1] <= m[i - 1][1])
      return `warp points must rise through the source: ${m[i][1]}s is not after ${m[i - 1][1]}s`;
    if (m[i][0] <= m[i - 1][0])
      return `a warp point must stay between its neighbours: beat ${m[i][0]} is not after beat ${m[i - 1][0]}`;
  }
  return null;
}
