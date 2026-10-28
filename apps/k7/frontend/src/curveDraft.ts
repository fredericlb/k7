// curveDraft.ts — the curve editor's state (`ui curve`) and everything it computes without a DOM: a
// draft from a curve or from nothing, the fields `curve set` writes, the preview's samples, and a drawn
// point placed where the pointer is. Every value is read through @studio/song-schema's curveMath, the
// same arithmetic the bake uses, so the preview is what plays. See docs/curveEditor.md.

import type {
  CurveCondition,
  CurveCut,
  CurveSpec,
  LfoShape,
} from "@studio/graph-model";
import {
  ADSR_DEFAULT_LEVEL,
  LFO_SHAPES,
  pointBeats,
  previewBeats,
  previewParts,
  previewSpan,
  previewOf as specPreview,
} from "@studio/song-schema/curveMath";
import {
  beatsToPosition,
  parseDuration,
  TIMECODE,
} from "@studio/song-schema/timecode";

/** What the shape select offers: the four oscillators, the envelope, the drawn curve, and a boolean's on/off. */
export type DraftShape = LfoShape | "adsr" | "custom" | "onoff";
const DRAFT_SHAPES: readonly DraftShape[] = [
  ...LFO_SHAPES,
  "adsr",
  "custom",
  "onoff",
];

/** What kind of param the curve drives — absent when none is in view (`ui curve`), which offers every shape. */
export type ParamKind = "number" | "boolean";

/** The shapes a param of this kind can follow: a number every curve but on/off, a boolean on/off alone. */
export function shapesFor(kind?: ParamKind): readonly DraftShape[] {
  if (kind === "boolean") return ["onoff"];
  if (kind === "number") return DRAFT_SHAPES.filter((s) => s !== "onoff");
  return DRAFT_SHAPES;
}

/** Whether the shape is made of points drawn by hand — the custom curve and the on/off. */
export const isDrawnShape = (s: DraftShape): boolean =>
  s === "custom" || s === "onoff";

/** One of WHEN the curve runs: from a moment, until one, between two, or on its node's event. */
export type DraftWhen = CurveCondition["type"];
export const DRAFT_WHENS: readonly DraftWhen[] = [
  "start",
  "end",
  "between",
  "event",
];

/** One condition as the editor holds it — every moment kept, so switching its kind loses nothing. */
export interface DraftCondition {
  when: DraftWhen;
  /** `start`'s and `between`'s opening, `end`'s close — one field per moment, so switching keeps them. */
  startAt: string;
  endAt: string;
  event: string;
  retrigger: boolean;
}

/** A new condition's fields, before the person picks anything. */
export const newCondition = (event = "Note On"): DraftCondition => ({
  when: "start",
  startAt: "1:1:1",
  endAt: "5:1:1",
  event,
  retrigger: false,
});

/** Every field the editor holds, whichever shape is picked — switching shape keeps the others. */
export interface CurveDraft {
  /** The curve runs while ANY of them holds; none is always. */
  conditions: DraftCondition[];
  shape: DraftShape;
  polarity: "unipolar" | "bipolar";
  amplitude: number;
  /** Which half of the output it keeps — written only when not `none`. */
  cut: CurveCut;
  frequency: number;
  /** An oscillator's length, a 0-based timecode — "0" runs for ever. */
  duration: string;
  phase: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  level: number;
  points: { time: string; value: number }[];
}

/** A fresh curve's name: a uuid, valid as a file name and never taken. */
export const newCurveName = (): string => crypto.randomUUID();

/** The draft a curve opens on — its own fields over the defaults, or the defaults alone for a new one. */
export function draftOf(spec?: CurveSpec): CurveDraft {
  const base: CurveDraft = {
    conditions: [],
    shape: "sine",
    polarity: "unipolar",
    amplitude: 1,
    cut: "none",
    frequency: 1,
    duration: "0",
    phase: 0,
    attack: 50,
    decay: 200,
    sustain: 300,
    release: 400,
    level: ADSR_DEFAULT_LEVEL,
    points: [
      { time: "1:1:1", value: 0 },
      { time: "3:1:1", value: 1 },
    ],
  };
  if (!spec) return base;
  const common = {
    ...base,
    conditions: (spec.conditions ?? []).map(draftCondition),
    polarity: spec.polarity,
    amplitude: spec.amplitude,
    cut: spec.cut ?? "none",
  };
  if (spec.type === "lfo")
    return {
      ...common,
      shape: spec.shape,
      frequency: spec.frequency,
      duration: spec.duration ?? "0",
      phase: spec.phase,
    };
  if (spec.type === "custom" || spec.type === "onoff")
    return { ...common, shape: spec.type, points: spec.points };
  const { attack, decay, sustain, release, level } = spec;
  return { ...common, shape: "adsr", attack, decay, sustain, release, level };
}

/** The draft as the curve it describes — what the preview samples. */
function specOf(d: CurveDraft): CurveSpec {
  const { polarity, amplitude } = d;
  // An on/off curve has no cut, being 0 or 1 already; `none` is the default and is left out.
  const cut = d.cut === "none" ? {} : { cut: d.cut };
  if (d.shape === "custom")
    return { type: "custom", polarity, amplitude, ...cut, points: d.points };
  // A boolean has no depth and no sign, and its points are off or on whatever the draft held.
  if (d.shape === "onoff")
    return {
      type: "onoff",
      polarity: "unipolar",
      amplitude: 1,
      points: d.points.map((p) => ({ ...p, value: p.value >= 0.5 ? 1 : 0 })),
    };
  if (d.shape === "adsr") {
    const { attack, decay, sustain, release, level } = d;
    return {
      type: "adsr",
      polarity,
      amplitude,
      ...cut,
      attack,
      decay,
      sustain,
      release,
      level,
    };
  }
  const { frequency, phase } = d;
  // Only a finite one is carried: "0" — or a length not yet typed whole — runs for ever.
  const lasts =
    durationBeats(d.duration, 4, 4) > 0 ? { duration: d.duration.trim() } : {};
  return {
    type: "lfo",
    polarity,
    amplitude,
    ...cut,
    shape: d.shape,
    frequency,
    phase,
    ...lasts,
  };
}

/** A curve's condition as the editor holds it. */
function draftCondition(c: CurveCondition): DraftCondition {
  const base = { ...newCondition(), retrigger: !!c.retrigger };
  if (c.type === "start") return { ...base, when: "start", startAt: c.at };
  if (c.type === "end") return { ...base, when: "end", endAt: c.at };
  if (c.type === "between")
    return { ...base, when: "between", startAt: c.start, endAt: c.end };
  return { ...base, when: "event", event: c.event };
}

/** The fields `curve set` writes: the spec, the polarity only when not the default, the conditions when there are any. */
export function fieldsOf(d: CurveDraft): Record<string, unknown> {
  const conditions = d.conditions.map(conditionOf);
  const when = conditions.length ? { conditions } : {};
  // An on/off curve's file is its points and conditions, and nothing a boolean cannot have.
  if (d.shape === "onoff") {
    const spec = specOf(d);
    return {
      type: "onoff",
      points: spec.type === "onoff" ? spec.points : [],
      ...when,
    };
  }
  const { polarity, ...rest } = specOf(d);
  return {
    ...rest,
    ...(polarity === "bipolar" ? { polarity } : {}),
    ...when,
  };
}

/** One draft condition as the file writes it; `retrigger` only when it is on. */
function conditionOf(d: DraftCondition): CurveCondition {
  const again = d.retrigger ? { retrigger: true } : {};
  const t = (tc: string) => tc.trim();
  switch (d.when) {
    case "start":
      return { type: "start", at: t(d.startAt), ...again };
    case "end":
      return { type: "end", at: t(d.endAt), ...again };
    case "between":
      return {
        type: "between",
        start: t(d.startAt),
        end: t(d.endAt),
        ...again,
      };
    case "event":
      return { type: "event", event: d.event.trim(), ...again };
  }
}

/** Why the draft cannot be saved yet, or null — the first of its conditions that cannot be written. */
export function conditionsProblem(d: CurveDraft): string | null {
  for (const c of d.conditions) {
    const problem = conditionProblem(c);
    if (problem) return problem;
  }
  return null;
}

/** Why one condition cannot be written, or null — a moment that is not a timecode, an event with no name. */
export function conditionProblem(d: DraftCondition): string | null {
  const moments =
    d.when === "start"
      ? [d.startAt]
      : d.when === "end"
        ? [d.endAt]
        : d.when === "between"
          ? [d.startAt, d.endAt]
          : [];
  const bad = moments.find((m) => !TIMECODE.test(m.trim()));
  if (bad !== undefined) return `"${bad}" is not a timecode — like 5:1:1`;
  if (d.when === "event" && !d.event.trim()) return "name the event";
  return null;
}

/** How many bars the plot spans for a song-time curve: four, or past the last drawn point. */
export function spanBars(d: CurveDraft, num: number, den: number): number {
  if (!isDrawnShape(d.shape) || !d.points.length) return 4;
  const barBeats = num * (4 / den);
  const last = Math.max(...pointBeats(d.points, num, den).map((p) => p.beat));
  return Math.max(4, Math.ceil(last / barBeats + 0.001) + 1);
}

/** An oscillator's duration in beats, 0 for ever — and for a length that is not a timecode yet. */
function durationBeats(tc: string, num: number, den: number): number {
  const t = tc.trim();
  return TIMECODE.test(t) ? parseDuration(t, num, den) : 0;
}

/** Why the duration cannot be saved, or null. */
export function durationProblem(d: CurveDraft): string | null {
  if (d.shape === "adsr" || isDrawnShape(d.shape)) return null;
  return TIMECODE.test(d.duration.trim())
    ? null
    : `"${d.duration}" is not a length — like 2:0, or 0 for ever`;
}

/** What the plot spans in beats, and how much of it is drawn solid — `previewSpan`, the card's own. */
export function plotSpan(
  d: CurveDraft,
  num: number,
  den: number,
): { beats: number; solid: number } {
  return previewSpan(specOf(d), num, den);
}

/** The plot's vertical lines, a beat each and a bar marked — the card's own (`previewBeats`). */
export function previewGrid(
  d: CurveDraft,
  num: number,
  den: number,
): { x: number; bar: boolean }[] {
  return previewBeats(specOf(d), num, den);
}

/** The preview as its solid and faded lines, split through an exact boundary sample — the card's own (`previewParts`). */
export function previewLines(
  d: CurveDraft,
  num: number,
  den: number,
): { solid: { x: number; y: number }[]; faded: { x: number; y: number }[] } {
  return previewParts(specOf(d), num, den);
}

/** The preview: `n` samples, x from 0 to 1 across the plot, y the curve's output — the graph's curve card draws the same. */
export function previewOf(
  d: CurveDraft,
  num: number,
  den: number,
  n = 160,
): { x: number; y: number }[] {
  return specPreview(specOf(d), num, den, n);
}

/** A sixteenth: where a drawn point snaps in time. */
const SNAP_BEATS = 0.25;

/** A drawn point at plot position (x 0..1, unit value 0..1), snapped to a sixteenth — and with `binary` to off or on. */
export function pointAt(
  x: number,
  unit: number,
  spanBeats: number,
  num: number,
  den: number,
  binary = false,
): { time: string; value: number } {
  const beat = Math.max(
    0,
    Math.round((x * spanBeats) / SNAP_BEATS) * SNAP_BEATS,
  );
  const clamped = Math.min(1, Math.max(0, unit));
  const value = binary
    ? clamped >= 0.5
      ? 1
      : 0
    : Math.round(clamped * 1000) / 1000;
  return { time: beatsToPosition(beat, num, den), value };
}

/** The points in time order, one per moment: the later write wins, as `curve point add` sets rather than duplicates. */
export function withPoint(
  points: readonly { time: string; value: number }[],
  p: { time: string; value: number },
  num: number,
  den: number,
  replacing?: string,
): { time: string; value: number }[] {
  // By BEAT, not by spelling: `2:1` and `2:1:1` are one moment.
  const beatOf = (time: string) =>
    pointBeats([{ time, value: 0 }], num, den)[0].beat;
  const at = beatOf(p.time);
  const gone = replacing === undefined ? Number.NaN : beatOf(replacing);
  const kept = points.filter((q) => {
    const b = beatOf(q.time);
    return Math.abs(b - at) > 1e-9 && !(Math.abs(b - gone) < 1e-9);
  });
  return [...kept, p].sort((a, b) => beatOf(a.time) - beatOf(b.time));
}
