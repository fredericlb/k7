// warpPoints.ts — placing, moving and removing the points of a clip's stretch map. Pure array work
// over `[timelineBeat, sourceSecond]` pairs, so the rule that matters — the map stays monotonic —
// is decided in one place and tested without a file. Full rationale: docs/warp.md.

/** One point of the map: where a moment of the SOURCE lands on the timeline. */
export type WarpMarker = [beat: number, sec: number];

/** How close two source seconds have to be to mean the same point. A millisecond: the UI hands
 *  back the exact second of the marker it grabbed, so this only has to survive a round trip. */
const SAME_SEC = 1e-3;

/**
 * Move the point at `sec` to `beat`, or place one there if none exists.
 *
 * NEIGHBOURS STAY WHERE THEY ARE. Only the two segments touching this point change their stretch;
 * the rest of the clip is untouched. That is what every DAW does, and it is the predictable half of
 * the choice: the alternative — redistributing the change outward — sounds smoother but means one
 * drag re-times material at the far end of the clip, which nobody can see from the handle they are
 * holding.
 *
 * Throws when the move would break the ORDER, because a map whose beats do not increase with its
 * seconds is not a slower or faster clip, it is a clip that plays backwards over that span. The
 * caller is told which neighbours it has to stay between rather than being silently clamped: a
 * handle that stops moving says more than one that lands somewhere it was not dropped.
 */
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

/**
 * Drop the point at `sec`.
 *
 * Refuses to go below two, which is the schema's own floor and is not arbitrary: a map with one
 * point states where a single moment lands and nothing about the rate anywhere, so it cannot be
 * applied at all. Removing the last INTERMEDIATE point is fine — that leaves an even stretch.
 */
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

/**
 * The two anchors a clip gets when it has no map yet: its start, and its end.
 *
 * An identity map, and the engine SKIPS it — a two-point warp whose ratio is 1 means "the source
 * already runs at the project tempo", and entering Tracktion's auto-tempo path for that is both
 * pointless and a bug it has (see applyClipWarp). So seeding changes nothing on its own, which is
 * the right behaviour: a clip you have not stretched should sound exactly as it did. The third
 * point is what makes it a warp.
 */
export function seedWarp(beats: number, seconds: number): WarpMarker[] {
  if (!(beats > 0) || !(seconds > 0))
    throw new Error("a clip needs a length in beats and in seconds to stretch");
  return [
    [0, 0],
    [beats, seconds],
  ];
}

/** The complaint about the first pair that is out of order, or null. Both axes must rise: seconds
 *  because the source only runs one way, beats because the timeline does too. */
function firstNonMonotonic(m: readonly WarpMarker[]): string | null {
  for (let i = 1; i < m.length; i++) {
    if (m[i][1] <= m[i - 1][1])
      return `warp points must rise through the source: ${m[i][1]}s is not after ${m[i - 1][1]}s`;
    if (m[i][0] <= m[i - 1][0])
      return `a warp point must stay between its neighbours: beat ${m[i][0]} is not after beat ${m[i - 1][0]}`;
  }
  return null;
}
