// curves.ts — automation curves: a normalised function of song time (curves/<id>.yaml)
// that drives automation, not yet what they're bound to. Two shapes: `lfo` (periodic,
// frequency in cycles/bar) and `custom` (hand-placed points, linear interpolation).
// `polarity` (unipolar 0..1 / bipolar -1..1) is per-curve — see sampleCurve.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  CurveCondition,
  CurveCut,
  CurvePolarity,
  CurveSpec,
  LfoShape,
} from "@studio/graph-model";
import {
  ADSR_DEFAULT_LEVEL,
  adsrMs,
  adsrUnit,
  CURVE_CUTS,
  cutOutput,
  LFO_SHAPES,
  sampleSpec,
} from "@studio/song-schema/curveMath";
import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import {
  CurveConditionSchema,
  CurveSchema,
} from "@studio/song-schema/yaml/entitySchemas";
import { stringify } from "yaml";
import { curveRuns, type EnvelopeFire } from "./curveConditions";
import { exportSub } from "./loader";
import { wsExists, wsRead, wsWrite } from "./yaml/workspaceFile";

export type Polarity = CurvePolarity;
export type { LfoShape };

// The model is the one the browser reads too (`CurveSpec`, @studio/graph-model); these name its three kinds.
export type LfoCurve = Extract<CurveSpec, { type: "lfo" }>;
export type CustomCurve = Extract<CurveSpec, { type: "custom" }>;
export type AdsrCurve = Extract<CurveSpec, { type: "adsr" }>;
export type OnOffCurve = Extract<CurveSpec, { type: "onoff" }>;
export type Curve = CurveSpec;
export interface CurvePoint {
  time: string; // a #Timecode position ("1:1:1" is the song start)
  value: number; // 0..1 (authored range; polarity decides the output range)
}

// The arithmetic is song-schema's, so the editor's preview and the bake below cannot disagree.
export { ADSR_DEFAULT_LEVEL, adsrMs, adsrUnit };

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

// Read `polarity`, defaulting to unipolar (the schema's default, and the safe range for an untold target).
function readPolarity(raw: unknown): Polarity {
  return raw === "bipolar" ? "bipolar" : "unipolar";
}

// Normalise one raw curve into the typed model, throwing on a shape it can't read — loud over sampling nonsense.
export function parseCurve(id: string, raw: any): Curve {
  const type = raw?.type;
  const polarity = readPolarity(raw?.polarity);
  // 0..1, scaling the output; absent is the whole range.
  const amplitude = clamp(Number(raw?.amplitude ?? 1), 0, 1);
  // WHEN it runs, any one of them — refused loudly when malformed, like every other field here (curveConditions.ts).
  let conditions: CurveCondition[] | undefined;
  if (raw?.conditions !== undefined) {
    const parsed = CurveConditionSchema.array().safeParse(raw.conditions);
    if (!parsed.success)
      throw new Error(
        `curve '${id}': conditions — ${parsed.error.issues[0]?.message ?? "unreadable"}`,
      );
    conditions = parsed.data;
  }
  const when = conditions?.length ? { conditions } : {};
  // Which half of the output it keeps — `none` is the default and is not carried (docs/curves.md, "Cut").
  const cut = raw?.cut ?? "none";
  if (!CURVE_CUTS.includes(cut))
    throw new Error(
      `curve '${id}': cut must be none, positive or negative (got ${raw.cut})`,
    );
  const shaped = cut === "none" ? when : { ...when, cut: cut as CurveCut };
  if (type === "lfo") {
    const frequency = Number(raw.frequency ?? 1);
    const phase = Number(raw.phase ?? 0);
    const shape = LFO_SHAPES.includes(raw?.shape)
      ? (raw.shape as LfoShape)
      : "sine";
    if (!(frequency > 0))
      throw new Error(
        `curve '${id}': lfo frequency must be > 0 (got ${raw.frequency})`,
      );
    // A length, 0-based; a zero one is for ever and is not carried (docs/curves.md, "Duration").
    const duration =
      raw?.duration === undefined ? "0" : String(raw.duration).trim();
    let durBeats: number;
    try {
      durBeats = parseDuration(duration, 4, 4);
    } catch {
      throw new Error(
        `curve '${id}': duration must be a length like 2:0 (got ${raw.duration})`,
      );
    }
    const lasts = durBeats > 0 ? { duration } : {};
    return {
      type: "lfo",
      polarity,
      amplitude,
      shape,
      frequency,
      phase,
      ...lasts,
      ...shaped,
    };
  }
  if (type === "custom") {
    const rawPts = Array.isArray(raw.points) ? raw.points : [];
    if (!rawPts.length)
      throw new Error(`curve '${id}': a custom curve needs at least one point`);
    const points: CurvePoint[] = rawPts.map((p: any) => ({
      time: String(p.time),
      value: clamp(Number(p.value), 0, 1),
    }));
    return { type: "custom", polarity, amplitude, points, ...shaped };
  }
  if (type === "onoff") {
    const rawPts = Array.isArray(raw.points) ? raw.points : [];
    if (!rawPts.length)
      throw new Error(
        `curve '${id}': an on/off curve needs at least one point`,
      );
    // Off or on and nothing between: anything at or past half is on.
    const points: CurvePoint[] = rawPts.map((p: any) => ({
      time: String(p.time),
      value: Number(p.value) >= 0.5 ? 1 : 0,
    }));
    // A boolean has no depth and no sign: unipolar at full amplitude, whatever the file might say.
    return {
      type: "onoff",
      polarity: "unipolar",
      amplitude: 1,
      points,
      ...when,
    };
  }
  if (type === "adsr") {
    // Every stage defaults to 0 but the level, which would otherwise decay to silence — docs/curves.md.
    const ms = (v: any, what: string) => {
      const n = Number(v ?? 0);
      if (!(n >= 0) || !Number.isFinite(n))
        throw new Error(
          `curve '${id}': adsr ${what} must be a duration in ms (got ${v})`,
        );
      return n;
    };
    return {
      type: "adsr",
      polarity,
      amplitude,
      ...shaped,
      attack: ms(raw.attack, "attack"),
      decay: ms(raw.decay, "decay"),
      sustain: ms(raw.sustain, "sustain"),
      release: ms(raw.release, "release"),
      level: clamp(Number(raw.level ?? ADSR_DEFAULT_LEVEL), 0, 1),
    };
  }
  throw new Error(
    `curve '${id}': unknown type '${type}' (expected "lfo", "custom", "adsr" or "onoff")`,
  );
}

// Scaffold curves/<id>.yaml as an LFO, refusing to overwrite, and return its path — see docs/curves.md.
export function createCurveFile(dir: string, id: string): string {
  // The filename IS the id, so it has to be one a path and a reference can both carry.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid curve name '${id}' — letters, digits, '_' and '-' only`,
    );
  const rel = `curves/${id}.yaml`;
  const path = join(dir, rel);
  if (wsExists(path)) throw new Error(`curve '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWrite(
    path,
    `type: lfo
` +
      `shape: sine        # sine | triangle | saw | square
` +
      `frequency: 1       # cycles per bar
` +
      `polarity: unipolar # unipolar 0..1 | bipolar -1..1
` +
      `phase: 0           # 0..1 of a cycle
`,
  );
  return rel;
}

/** The fields of each kind, in the order a file lists them — what `writeCurveFile` keeps and nothing else. */
const CURVE_FIELDS: Record<CurveSpec["type"], string[]> = {
  lfo: [
    "type",
    "shape",
    "frequency",
    "phase",
    "duration",
    "amplitude",
    "polarity",
    "cut",
    "conditions",
  ],
  custom: ["type", "amplitude", "polarity", "cut", "points", "conditions"],
  onoff: ["type", "points", "conditions"],
  adsr: [
    "type",
    "attack",
    "decay",
    "sustain",
    "release",
    "level",
    "amplitude",
    "polarity",
    "cut",
    "conditions",
  ],
};

/** Write `curves/<id>.yaml` WHOLE from `raw`, creating or replacing it — the curve editor's save; docs/curves.md. */
export function writeCurveFile(
  dir: string,
  id: string,
  raw: Record<string, unknown>,
): { rel: string; created: boolean } {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid curve name '${id}' — letters, digits, '_' and '-' only`,
    );
  const parsed = CurveSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `curve '${id}': ${parsed.error.issues.map((i) => `${i.path.join(".") || "curve"}: ${i.message}`).join("; ")}`,
    );
  // Read back through the model too, so a file this writes is one the compile reads.
  parseCurve(id, parsed.data);
  const value = parsed.data as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of CURVE_FIELDS[parsed.data.type])
    if (value[k] !== undefined) ordered[k] = value[k];
  const rel = `curves/${id}.yaml`;
  const path = join(dir, rel);
  const created = !wsExists(path);
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWrite(
    path,
    stringify(ordered, { lineWidth: 0, flowCollectionPadding: true }).replace(
      // One point a line, as `curve point` writes them: a moved point is a one-line diff.
      /^ {2}- time: "?([^"\n]+)"?\n {4}value: (.+)$/gm,
      '  - { time: "$1", value: $2 }',
    ),
  );
  return { rel, created };
}

/** Scaffold `curves/<id>.yaml` as a FLAT custom curve at the param's current value — docs/curves.md. */
export function createFlatCurveFile(
  dir: string,
  id: string,
  value: number,
  endTc: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid curve name '${id}' — letters, digits, '_' and '-' only`,
    );
  const rel = `curves/${id}.yaml`;
  const path = join(dir, rel);
  if (wsExists(path)) throw new Error(`curve '${id}' already exists (${rel})`);
  const v = Math.min(1, Math.max(0, value));
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWrite(
    path,
    [
      "type: custom",
      "polarity: unipolar # unipolar 0..1 | bipolar -1..1",
      "points:",
      `  - { time: "1:1:1", value: ${round6(v)} }`,
      `  - { time: "${endTc}", value: ${round6(v)} }`,
      "",
    ].join("\n"),
  );
  return rel;
}

export function loadCurves(dir: string): Record<string, Curve> {
  const raw = exportSub(dir, "curves") as Record<string, any>;
  const out: Record<string, Curve> = {};
  for (const [id, c] of Object.entries(raw ?? {})) out[id] = parseCurve(id, c);
  return out;
}

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
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

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

/** Read, transform, write one curve file — the `curve point` seam, see docs/curves.md. */
export function editCurveFile(
  dir: string,
  id: string,
  transform: (text: string) => string | null,
): string {
  const rel = `curves/${id}.yaml`;
  const path = join(dir, rel);
  if (!wsExists(path)) throw new Error(`no curve '${id}' (${rel})`);
  const before = wsRead(path);
  const after = transform(before);
  if (after === null) throw new Error(`nothing to edit in curve '${id}'`);
  if (after !== before) wsWrite(path, after);
  return rel;
}

/** Breakpoints with a cut applied: a point added where a segment crosses 0, so the engine's line is cut there and not at the next point. */
export function cutPoints(
  points: readonly [number, number][],
  cut: CurveCut,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const [b, v] = points[i];
    const prev = points[i - 1];
    if (prev && prev[1] * v < 0 && b > prev[0]) {
      const at = prev[0] + ((b - prev[0]) * -prev[1]) / (v - prev[1]);
      out.push([round6(at), 0]);
    }
    out.push([b, round6(cutOutput(v, cut))]);
  }
  return out;
}
