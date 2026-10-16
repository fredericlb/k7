// curveMath.ts — what a curve's VALUE is, as pure arithmetic: an oscillator's wave, an envelope's
// shape, a drawn curve's interpolation, and the amplitude and polarity every one of them leaves through.
// No fs, so the browser's curve editor previews with the very functions @studio/song bakes with.
// The one thing a reader would get wrong: a UNIT value is 0..1 before amplitude and polarity.
// See packages/song/docs/curves.md.

import type {
  CurveCut,
  CurvePolarity,
  CurveSpec,
  LfoShape,
} from "@studio/graph-model";
import { parseDuration, parsePosition } from "./timecode";

export const LFO_SHAPES: readonly LfoShape[] = [
  "sine",
  "triangle",
  "saw",
  "square",
];

/** Where an ADSR's decay lands when the file does not say — half up, the least opinionated envelope. */
export const ADSR_DEFAULT_LEVEL = 0.5;

/** An oscillator's unit value `cycles` into its run, 0..1. */
function lfoWave(shape: LfoShape, cycles: number): number {
  const f = cycles - Math.floor(cycles); // position within the cycle, 0..1
  switch (shape) {
    case "triangle":
      return f < 0.5 ? 2 * f : 2 * (1 - f);
    case "saw":
      return f;
    case "square":
      return f < 0.5 ? 1 : 0;
    default:
      return (Math.sin(2 * Math.PI * cycles) + 1) / 2;
  }
}

type Adsr = Extract<CurveSpec, { type: "adsr" }>;

/** The envelope's own length, in ms: what one trigger occupies before it is over. */
export const adsrMs = (c: Adsr): number =>
  c.attack + c.decay + c.sustain + c.release;

/** The envelope's unit value `ms` after its trigger, 0..1, flat 0 once over. */
export function adsrUnit(c: Adsr, ms: number): number {
  if (ms <= 0) return 0;
  if (ms < c.attack) return ms / c.attack;
  const d = ms - c.attack;
  if (d < c.decay) return 1 - (1 - c.level) * (d / c.decay);
  const h = d - c.decay;
  if (h < c.sustain) return c.level;
  const r = h - c.sustain;
  if (r < c.release) return c.level * (1 - r / c.release);
  return 0;
}

/** Points at beats, linearly interpolated; flat before the first and after the last. */
function pointsUnit(
  pts: readonly { beat: number; value: number }[],
  beat: number,
): number {
  if (!pts.length) return 0;
  if (beat <= pts[0].beat) return pts[0].value;
  const last = pts[pts.length - 1];
  if (beat >= last.beat) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (beat > b.beat) continue;
    const a = pts[i - 1];
    const span = b.beat - a.beat;
    // Coincident points take the later value.
    return span <= 0
      ? b.value
      : a.value + (b.value - a.value) * ((beat - a.beat) / span);
  }
  return last.value;
}

/** Points at beats, HELD: each one's value until the next, the first's before it — an on/off curve's stepping. */
function heldUnit(
  pts: readonly { beat: number; value: number }[],
  beat: number,
): number {
  if (!pts.length) return 0;
  let v = pts[0].value;
  for (const p of pts) {
    if (p.beat > beat) break;
    v = p.value;
  }
  return v;
}

/** A custom curve's points at their beats, in time order. */
export function pointBeats(
  points: readonly { time: string; value: number }[],
  num: number,
  den: number,
): { beat: number; value: number }[] {
  return points
    .map((p) => ({ beat: parsePosition(p.time, num, den), value: p.value }))
    .sort((a, b) => a.beat - b.beat);
}

/** What leaves the curve: the unit value scaled by `amplitude`, unipolar 0..amp or bipolar -amp..amp, then `cut`. */
function curveOutput(
  unit: number,
  polarity: CurvePolarity,
  amplitude: number,
  cut?: CurveCut,
): number {
  return cutOutput(
    (polarity === "bipolar" ? unit * 2 - 1 : unit) * amplitude,
    cut,
  );
}

/** The cuts a curve can take, the default first. */
export const CURVE_CUTS: readonly CurveCut[] = ["none", "positive", "negative"];

/** An output with its cut applied: `positive` keeps [0,1], `negative` keeps [-1,0], `none` all of it. */
export function cutOutput(v: number, cut?: CurveCut): number {
  if (cut === "positive") return Math.max(0, v);
  if (cut === "negative") return Math.min(0, v);
  return v;
}

/** A curve's output at song beat `beat` — an ADSR has none there, only after a trigger, so 0. */
export function sampleSpec(
  c: CurveSpec,
  beat: number,
  num: number,
  den: number,
): number {
  const barBeats = num * (4 / den);
  const unit =
    c.type === "adsr"
      ? 0
      : c.type === "lfo"
        ? lfoWave(
            c.shape,
            c.frequency * (barBeats > 0 ? beat / barBeats : 0) + c.phase,
          )
        : c.type === "onoff"
          ? heldUnit(pointBeats(c.points, num, den), beat)
          : pointsUnit(pointBeats(c.points, num, den), beat);
  return curveOutput(unit, c.polarity, c.amplitude, c.cut);
}

/** How much of the next cycle an endless oscillator's picture shows, faded. */
const NEXT_CYCLE = 0.25;

/** What a curve's picture spans in beats, and how much of it is solid — a drawn curve its bars, an endless oscillator a cycle and a bit. */
export function previewSpan(
  c: CurveSpec,
  num: number,
  den: number,
): { beats: number; solid: number } {
  const barBeats = num * (4 / den);
  // An envelope has no song time: its picture is over its own length, in ms (`previewOf`).
  if (c.type === "adsr") return { beats: 0, solid: 0 };
  if (c.type === "custom" || c.type === "onoff") {
    const last = c.points.length
      ? Math.max(...pointBeats(c.points, num, den).map((p) => p.beat))
      : 0;
    const bars = Math.max(4, Math.ceil(last / barBeats + 0.001) + 1);
    return { beats: bars * barBeats, solid: bars * barBeats };
  }
  const dur = c.duration ? parseDuration(c.duration, num, den) : 0;
  if (dur > 0) return { beats: dur, solid: dur };
  const cycle = barBeats / c.frequency;
  return { beats: cycle * (1 + NEXT_CYCLE), solid: cycle };
}

/** A curve's picture: `n` samples, x 0..1 across `previewSpan`, y its output — what the editor and the graph's card both draw. */
export function previewOf(
  c: CurveSpec,
  num: number,
  den: number,
  n = 160,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (c.type === "adsr") {
    // Its own length from the trigger, with a release's room after it.
    const total = Math.max(1, adsrMs(c)) * 1.1;
    for (let i = 0; i <= n; i++)
      out.push({
        x: i / n,
        y: curveOutput(
          adsrUnit(c, (i / n) * total),
          c.polarity,
          c.amplitude,
          c.cut,
        ),
      });
    return out;
  }
  const { beats } = previewSpan(c, num, den);
  for (let i = 0; i <= n; i++)
    out.push({ x: i / n, y: sampleSpec(c, (i / n) * beats, num, den) });
  return out;
}

/** The picture as two lines: the solid span and the faded rest, both through an exact sample at the boundary — a saw's drop there is in the solid. */
export function previewParts(
  c: CurveSpec,
  num: number,
  den: number,
  n = 160,
): { solid: { x: number; y: number }[]; faded: { x: number; y: number }[] } {
  const pts = previewOf(c, num, den, n);
  const { beats, solid } = previewSpan(c, num, den);
  const cut = beats ? solid / beats : 1;
  if (cut >= 1) return { solid: pts, faded: [] };
  const edge = { x: cut, y: sampleSpec(c, solid, num, den) };
  const before = pts.filter((p) => p.x < cut - 1e-9);
  const after = pts.filter((p) => p.x > cut + 1e-9);
  return { solid: [...before, edge], faded: [edge, ...after] };
}

/** The picture's vertical lines: one per metrical beat across the span, `bar` on every bar's first — none for an envelope, which has no song time. */
export function previewBeats(
  c: CurveSpec,
  num: number,
  den: number,
): { x: number; bar: boolean }[] {
  const { beats } = previewSpan(c, num, den);
  if (!beats) return [];
  const beatLen = 4 / den;
  const count = Math.floor(beats / beatLen + 1e-6);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: (i * beatLen) / beats,
    bar: i % num === 0,
  }));
}

/** Where song beat `beat` falls on the picture, and the value there — an endless oscillator wraps, a finite curve holds its end; none for an envelope. */
export function previewPlayhead(
  c: CurveSpec,
  beat: number,
  num: number,
  den: number,
): { x: number; y: number } | null {
  const { beats, solid } = previewSpan(c, num, den);
  if (!beats || beat < 0) return null;
  // An endless oscillator's picture is one cycle: the song beat folds into it, its phase being the song's.
  const endless = c.type === "lfo" && solid < beats;
  const at = endless ? beat % solid : Math.min(beat, solid);
  return { x: at / beats, y: sampleSpec(c, at, num, den) };
}
