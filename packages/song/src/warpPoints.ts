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

/**
 * The map a clip FILE declares, and whether the file itself declines it.
 *
 * Here because there are TWO compilers — `nodeProject` builds a placement, `project.mapClip`
 * builds the unplaced clip a surface draws before any lane names it — and only the first of them
 * ever read `warp`. So the clip editor, which asks for the whole FILE, was handed a document with
 * no map at all: no stretch marks were drawn in the warp view, ever, and `warpStretch` priced a
 * warped clip at 1 so the picture was drawn at the wrong rate into the bargain.
 *
 * The DECLINE is answered separately rather than folded in, because the two callers need
 * different things from it: a placement that declines still has to say `warpOff` so the timeline
 * can cross its icon, while an unplaced clip has nobody to say it to. Fewer than two markers is
 * no map — one point cannot state a rate.
 */
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

/**
 * The timeline BEAT a source second lands on, through the map — segment by segment.
 *
 * **The engine is piecewise and the drawing was not.** `applyClipWarp` pins every interior marker
 * as a beat point so each segment stretches on its own (EditBuilder.cpp), while `warpStretch`
 * answers ONE ratio — the first marker to the last. That ratio is the right answer to "how long is
 * this clip", which is what it was written for, and the wrong one for "where is this moment": a
 * point pinned in the middle moved the sound and left the picture where it was.
 *
 * Outside the map, the end segments' own rate continues. Extrapolating rather than clamping is
 * what the engine does too — a clip is not silent past its last marker — and it keeps this
 * monotonic, which is what makes `sourceAtBeat` below an inverse rather than a guess.
 */
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

/**
 * The map, made to describe a source of `seconds` again — after a bounce rewrote the file.
 *
 * The engine hands Tracktion the map's beat span as the length of the WHOLE source and lets
 * auto-tempo stretch (`applyClipWarp`). So the map's last point has to sit at the file's end, or
 * the engine reads the take's tempo off the wrong duration: a render that appended a two-second
 * tail to an 17.92 s take turned 110 bpm into 98.9, played everything 11% slow, and — since an
 * unlooped clip is capped at its window in SOURCE seconds — cut the phrase before its end.
 *
 * The material itself is untouched by a bounce: same start, same rate, sample for sample. So
 * every existing point keeps its second, and only the END moves. What is appended continues at
 * the map's own overall rate, which is the one thing here that is measured rather than assumed —
 * a tail is not musical material, and the rate the take already had is the honest extension.
 *
 * Shortening is the same statement backwards: points past the new end describe audio that is no
 * longer there, so they go, and the last one lands on the end. Two points are kept whatever
 * happens, since a one-point map states nothing about rate and cannot be applied.
 *
 * `null` when nothing needs to change — the caller writes no file, which is what keeps a bounce
 * that changed no duration a one-line diff.
 */
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
  // Already describes this file: a millisecond either way is the same end, and rewriting for it
  // would churn the file on every bounce that changed nothing.
  if (Math.abs(last[1] - seconds) <= SAME_SEC) return null;

  const rate = beatSpan / srcSpan; // beats per source second, over the whole map
  const kept = markers.filter((m) => m[1] < seconds - SAME_SEC);
  // The first point is the anchor and stays whatever the new length is — a file trimmed to
  // nothing before it would leave no map at all, and the floor below is what says so.
  if (kept.length === 0) kept.push([first[0], first[1]]);
  const at = kept[kept.length - 1];
  const out: WarpMarker[] = kept.map((m): WarpMarker => [m[0], m[1]]);
  // Six decimals, which is what every marker an importer writes already carries — a microsecond
  // and a millionth of a beat. The map goes in a file a person reads and a diff shows, and
  // `36.49944379017857` beside `15.336937` is noise in both.
  out.push([round6(at[0] + (seconds - at[1]) * rate), round6(seconds)]);
  return out.length >= 2 ? out : null;
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

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
