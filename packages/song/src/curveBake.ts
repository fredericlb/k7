// curveBake.ts — a curve sampled and baked into the breakpoints the engine plays: an LFO over the
// song's length, an ADSR at each of its fires, any curve under its conditions. What a reader gets
// wrong: an envelope is placed by its EVENTS, every other curve is a function of song time. docs/curves.md.

import { adsrUnit, sampleSpec } from "@studio/song-schema/curveMath";
import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import { curveRuns, type EnvelopeFire } from "./curveConditions";
import {
  type AdsrCurve,
  type Curve,
  type CustomCurve,
  cutPoints,
  type LfoCurve,
  type OnOffCurve,
} from "./curves";

// The value a curve holds at song position `beat`: unipolar 0..amp, bipolar -amp..amp — curveMath.ts's sampleSpec.
export function sampleCurve(
  curve: Curve,
  beat: number,
  num: number,
  den: number,
): number {
  return sampleSpec(curve, beat, num, den);
}

// --- baking to engine breakpoints --------------------------------------------

const LFO_BAKE_PER_BAR = 24; // breakpoints per bar for an LFO (the engine interpolates)
const LFO_BAKE_MAX_POINTS = 2048; // cap, so a long song can't explode the point count
export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// A curve baked to engine breakpoints; `points` are [beat, output] in the curve's OWN range, `bipolar` alongside.
export interface BakedCurve {
  bipolar: boolean;
  points: [number, number][];
}

/** ms -> quarter-note beats at `tempo` BPM. */
const msToBeats = (ms: number, tempo: number) => (ms / 1000) * (tempo / 60);

/** An envelope at each of `triggers`, five corners apiece, an early trigger CUTTING it — docs/curves.md. */
export function bakeAdsr(
  curve: AdsrCurve,
  // A bare beat takes `opts`; a firing carries its own window's end and its own retrigger (curveConditions.ts).
  triggers: readonly (number | EnvelopeFire)[],
  tempo: number,
  // `retrigger` false: a trigger landing while one runs is IGNORED rather than cutting it; `stop` cuts it.
  opts: { retrigger?: boolean; stop?: number } = {},
): BakedCurve {
  // Cut AFTER the shape is baked, so a corner crossing 0 gets its crossing rather than a slope to the clamp.
  if (curve.cut && curve.cut !== "none") {
    const whole = bakeAdsr({ ...curve, cut: undefined }, triggers, tempo, opts);
    return { ...whole, points: cutPoints(whole.points, curve.cut) };
  }
  const bipolar = curve.polarity === "bipolar";
  const A = msToBeats(curve.attack, tempo);
  const D = msToBeats(curve.decay, tempo);
  const S = msToBeats(curve.sustain, tempo);
  const R = msToBeats(curve.release, tempo);
  const sorted = triggers
    .map(
      (t): EnvelopeFire =>
        typeof t === "number"
          ? { at: t, stop: opts.stop, retrigger: opts.retrigger !== false }
          : t,
    )
    .filter((f) => f.stop === undefined || f.at < f.stop)
    .sort((a, b) => a.at - b.at);
  const at = spaced(sorted, A + D + S + R);
  const beatsToMs = (b: number) => (b * 60000) / tempo;
  const out: [number, number][] = [];
  const EPS = 1e-6; // a microbeat — under a sample at any tempo, and the point grid's own step
  const put = (beat: number, unit: number) => {
    const v = (bipolar ? unit * 2 - 1 : unit) * curve.amplitude;
    const last = out[out.length - 1];
    // A corner on the beat one already sits at is NUDGED past it, never dropped — see docs/curves.md.
    const v6 = round6(v);
    const coincident = !!last && beat <= last[0] + EPS / 2;
    // …unless it repeats the value, which says nothing the point before it did not.
    if (coincident && last[1] === v6) return;
    out.push([round6(coincident ? last[0] + EPS : beat), v6]);
  };
  for (let i = 0; i < at.length; i++) {
    const t = at[i].at;
    const next = Math.min(
      i + 1 < at.length ? at[i + 1].at : Number.POSITIVE_INFINITY,
      at[i].stop ?? Number.POSITIVE_INFINITY,
    );
    const corners: [number, number][] = [
      [t, 0],
      [t + A, 1],
      [t + A + D, curve.level],
      [t + A + D + S, curve.level],
      [t + A + D + S + R, 0],
    ];
    for (const [b, u] of corners) {
      // Strictly past, not at: one ENDING where the next starts has nothing left to cut.
      if (b > next) {
        // Cut short at the value the shape had actually reached, so the line into it is its own.
        put(next - 1e-6, adsrUnit(curve, beatsToMs(next - t)));
        break;
      }
      put(b, u);
    }
  }
  return { bipolar, points: out };
}

/** The firings kept: a retriggering one always, one that may not cut only when no envelope still runs — `len` beats, or to its cut. */
function spaced(sorted: readonly EnvelopeFire[], len: number): EnvelopeFire[] {
  const out: EnvelopeFire[] = [];
  let free = Number.NEGATIVE_INFINITY;
  for (const f of sorted)
    if (f.retrigger || f.at >= free) {
      out.push(f);
      free = Math.min(f.at + len, f.stop ?? Number.POSITIVE_INFINITY);
    }
  return out;
}

// Bake over the song: a custom curve emits verbatim, an LFO samples on a grid, widened to respect the point cap.
export function bakeCurve(
  curve: Curve,
  num: number,
  den: number,
  songBeats: number,
  // The note-ons of the node the curve drives — read only by an `event` condition.
  triggers: readonly number[] = [],
): BakedCurve {
  // Cut AFTER the shape is baked, as an envelope is — see `cutPoints`.
  if (curve.type !== "onoff" && curve.cut && curve.cut !== "none") {
    const whole = bakeCurve(
      { ...curve, cut: undefined },
      num,
      den,
      songBeats,
      triggers,
    );
    return { ...whole, points: cutPoints(whole.points, curve.cut) };
  }
  const bipolar = curve.polarity === "bipolar";
  let beats: number[];
  if (curve.type === "adsr") {
    // No triggers here — bakeAdsr is the entry point that has them, and flat 0 keeps this total.
    return { bipolar, points: [[0, bipolar ? -1 : 0]] };
  }
  if (curve.conditions?.length || (curve.type === "lfo" && curve.duration))
    return bakeConditioned(curve, num, den, songBeats, triggers);
  if (curve.type === "custom") {
    beats = curve.points
      .map((p) => parsePosition(p.time, num, den))
      .sort((a, b) => a - b);
  } else if (curve.type === "onoff") {
    beats = stepBeats(curve.points.map((p) => parsePosition(p.time, num, den)));
  } else {
    const barBeats = num * (4 / den);
    const end = Math.max(songBeats, barBeats * 4);
    let step = barBeats / LFO_BAKE_PER_BAR;
    if (end / step > LFO_BAKE_MAX_POINTS) step = end / LFO_BAKE_MAX_POINTS;
    beats = [];
    for (let b = 0; b <= end + step * 0.5; b += step) beats.push(b);
  }
  const points = beats.map((b): [number, number] => [
    round6(b),
    round6(sampleCurve(curve, b, num, den)),
  ]);
  return { bipolar, points };
}

/** An on/off curve's corners, each preceded by a microbeat holding the value before it: the engine steps, never ramps. */
function stepBeats(corners: readonly number[]): number[] {
  const sorted = [...corners].sort((a, b) => a - b);
  return sorted.flatMap((b, i) => (i === 0 ? [b] : [b - 1e-6, b]));
}

/** A song-time curve under its conditions and its duration: sampled over each of its runs, its own time counted from the run's origin. */
function bakeConditioned(
  curve: LfoCurve | CustomCurve | OnOffCurve,
  num: number,
  den: number,
  songBeats: number,
  triggers: readonly number[],
): BakedCurve {
  const barBeats = num * (4 / den);
  const end = Math.max(songBeats, barBeats * 4);
  // A duration ends each run that long after its own start; past it the engine holds where it stopped.
  const dur =
    curve.type === "lfo" && curve.duration
      ? parseDuration(curve.duration, num, den)
      : Number.POSITIVE_INFINITY;
  const runs = curveRuns(curve.conditions, end, triggers, num, den)
    .map((r) => ({ ...r, to: Math.min(r.to, r.origin + dur) }))
    .filter((r) => r.to > r.from);
  const span = runs.reduce((n, r) => n + (r.to - r.from), 0);
  let step = barBeats / LFO_BAKE_PER_BAR;
  if (span / step > LFO_BAKE_MAX_POINTS) step = span / LFO_BAKE_MAX_POINTS;
  const drawn =
    curve.type === "custom"
      ? curve.points.map((p) => parsePosition(p.time, num, den))
      : curve.type === "onoff"
        ? stepBeats(curve.points.map((p) => parsePosition(p.time, num, den)))
        : [];
  const out: [number, number][] = [];
  for (const run of runs) {
    // A drawn curve's corners where they fall in the run, an oscillator's grid; both ends of the run always.
    const at = new Set([run.from, run.to]);
    if (curve.type !== "lfo") {
      for (const b of drawn)
        if (b + run.origin > run.from && b + run.origin < run.to)
          at.add(b + run.origin);
    }
    // Short of the end by a microbeat: a step landing a hair under it would round onto it and be nudged past.
    else for (let b = run.from + step; b < run.to - 1e-6; b += step) at.add(b);
    for (const b of [...at].sort((x, y) => x - y)) {
      const last = out[out.length - 1];
      // A retriggered run starts where the last ended: nudged a microbeat on, so the jump is a step, not a slope.
      const beat = last && b <= last[0] ? last[0] + 1e-6 : b;
      out.push([
        round6(beat),
        round6(sampleCurve(curve, b - run.origin, num, den)),
      ]);
    }
  }
  return { bipolar: curve.polarity === "bipolar", points: out };
}
