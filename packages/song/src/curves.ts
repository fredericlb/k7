// curves.ts — automation curves: a normalised function of song time (curves/<id>.yaml)
// that drives automation, not yet what they're bound to. Two shapes: `lfo` (periodic,
// frequency in cycles/bar) and `custom` (hand-placed points, linear interpolation).
// `polarity` (unipolar 0..1 / bipolar -1..1) is per-curve — see sampleCurve.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePosition } from "@studio/song-schema/timecode";
import { exportSub } from "./loader";

export type Polarity = "unipolar" | "bipolar";
export type LfoShape = "sine" | "triangle" | "saw" | "square";

const LFO_SHAPES: readonly LfoShape[] = ["sine", "triangle", "saw", "square"];

export interface LfoCurve {
  type: "lfo";
  polarity: Polarity;
  shape: LfoShape; // the waveform (default sine)
  frequency: number; // cycles per bar (>0)
  phase: number; // 0..1 of a cycle
}

export interface CurvePoint {
  time: string; // a #Timecode position ("1:1:1" is the song start)
  value: number; // 0..1 (authored range; polarity decides the output range)
}

export interface CustomCurve {
  type: "custom";
  polarity: Polarity;
  points: CurvePoint[]; // at least one; kept in time order (sorted defensively)
}

/** An envelope in MILLISECONDS, restarted by an event instead of read off song time — docs/curves.md. */
export interface AdsrCurve {
  type: "adsr";
  polarity: Polarity;
  attack: number; // ms
  decay: number; // ms
  sustain: number; // ms — a hold at `level`
  release: number; // ms
  level: number; // 0..1
}

export type Curve = LfoCurve | CustomCurve | AdsrCurve;

/** Where decay lands when the file does not say — half up, the least opinionated envelope. */
export const ADSR_DEFAULT_LEVEL = 0.5;

/** The envelope's own length, in ms. What one trigger occupies before it is over. */
export const adsrMs = (c: AdsrCurve): number =>
  c.attack + c.decay + c.sustain + c.release;

/** The envelope's unit value `ms` after its trigger, 0..1, flat 0 once over — see docs/curves.md. */
export function adsrUnit(c: AdsrCurve, ms: number): number {
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
    return { type: "lfo", polarity, shape, frequency, phase };
  }
  if (type === "custom") {
    const rawPts = Array.isArray(raw.points) ? raw.points : [];
    if (!rawPts.length)
      throw new Error(`curve '${id}': a custom curve needs at least one point`);
    const points: CurvePoint[] = rawPts.map((p: any) => ({
      time: String(p.time),
      value: clamp(Number(p.value), 0, 1),
    }));
    return { type: "custom", polarity, points };
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
      attack: ms(raw.attack, "attack"),
      decay: ms(raw.decay, "decay"),
      sustain: ms(raw.sustain, "sustain"),
      release: ms(raw.release, "release"),
      level: clamp(Number(raw.level ?? ADSR_DEFAULT_LEVEL), 0, 1),
    };
  }
  throw new Error(
    `curve '${id}': unknown type '${type}' (expected "lfo", "custom" or "adsr")`,
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
  if (existsSync(path))
    throw new Error(`curve '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "curves"), { recursive: true });
  writeFileSync(
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
    "utf8",
  );
  return rel;
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
  if (existsSync(path))
    throw new Error(`curve '${id}' already exists (${rel})`);
  const v = Math.min(1, Math.max(0, value));
  mkdirSync(join(dir, "curves"), { recursive: true });
  writeFileSync(
    path,
    [
      "type: custom",
      "polarity: unipolar # unipolar 0..1 | bipolar -1..1",
      "points:",
      `  - { time: "1:1:1", value: ${round6(v)} }`,
      `  - { time: "${endTc}", value: ${round6(v)} }`,
      "",
    ].join("\n"),
    "utf8",
  );
  return rel;
}

export function loadCurves(dir: string): Record<string, Curve> {
  const raw = exportSub(dir, "curves") as Record<string, any>;
  const out: Record<string, Curve> = {};
  for (const [id, c] of Object.entries(raw ?? {})) out[id] = parseCurve(id, c);
  return out;
}

// The value a curve holds at song position `beat`: unipolar 0..1, bipolar remapped v -> 2v-1.
export function sampleCurve(
  curve: Curve,
  beat: number,
  num: number,
  den: number,
): number {
  const barBeats = num * (4 / den); // quarter notes per bar
  // An ADSR has no value at a song position, only since a TRIGGER — 0 is untriggered (docs/curves.md).
  const unit =
    curve.type === "adsr"
      ? 0
      : curve.type === "lfo"
        ? lfoUnit(curve, beat, barBeats)
        : customUnit(curve, beat, num, den);
  // unit is 0..1; polarity picks the range it leaves in.
  return curve.polarity === "bipolar" ? unit * 2 - 1 : unit;
}

// The LFO's unit value at `beat`, in 0..1 (bipolar remapping happens once, in sampleCurve, for both curve kinds).
function lfoUnit(curve: LfoCurve, beat: number, barBeats: number): number {
  const bars = barBeats > 0 ? beat / barBeats : 0;
  const cycles = curve.frequency * bars + curve.phase;
  const f = cycles - Math.floor(cycles); // position within the cycle, 0..1
  switch (curve.shape) {
    case "triangle":
      return f < 0.5 ? 2 * f : 2 * (1 - f);
    case "saw":
      return f;
    case "square":
      return f < 0.5 ? 1 : 0;
    case "sine":
    default:
      return (Math.sin(2 * Math.PI * cycles) + 1) / 2;
  }
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
  triggers: readonly number[],
  tempo: number,
): BakedCurve {
  const bipolar = curve.polarity === "bipolar";
  const at = [...triggers].sort((a, b) => a - b);
  const A = msToBeats(curve.attack, tempo);
  const D = msToBeats(curve.decay, tempo);
  const S = msToBeats(curve.sustain, tempo);
  const R = msToBeats(curve.release, tempo);
  const beatsToMs = (b: number) => (b * 60000) / tempo;
  const out: [number, number][] = [];
  const EPS = 1e-6; // a microbeat — under a sample at any tempo, and the point grid's own step
  const put = (beat: number, unit: number) => {
    const v = bipolar ? unit * 2 - 1 : unit;
    const last = out[out.length - 1];
    // A corner on the beat one already sits at is NUDGED past it, never dropped — see docs/curves.md.
    const v6 = round6(v);
    const coincident = !!last && beat <= last[0] + EPS / 2;
    // …unless it repeats the value, which says nothing the point before it did not.
    if (coincident && last[1] === v6) return;
    out.push([round6(coincident ? last[0] + EPS : beat), v6]);
  };
  for (let i = 0; i < at.length; i++) {
    const t = at[i];
    const next = i + 1 < at.length ? at[i + 1] : Number.POSITIVE_INFINITY;
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
// Bake over the song: a custom curve emits verbatim, an LFO samples on a grid, widened to respect the point cap.
export function bakeCurve(
  curve: Curve,
  num: number,
  den: number,
  songBeats: number,
): BakedCurve {
  const bipolar = curve.polarity === "bipolar";
  let beats: number[];
  if (curve.type === "adsr") {
    // No triggers here — bakeAdsr is the entry point that has them, and flat 0 keeps this total.
    return { bipolar, points: [[0, bipolar ? -1 : 0]] };
  }
  if (curve.type === "custom") {
    beats = curve.points
      .map((p) => parsePosition(p.time, num, den))
      .sort((a, b) => a - b);
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

// A custom curve's 0..1 value at `beat` by linear interpolation; flat before the first point and after the last.
function customUnit(
  curve: CustomCurve,
  beat: number,
  num: number,
  den: number,
): number {
  const pts = curve.points
    .map((p) => ({ beat: parsePosition(p.time, num, den), value: p.value }))
    .sort((a, b) => a.beat - b.beat);
  if (beat <= pts[0].beat) return pts[0].value;
  const last = pts[pts.length - 1];
  if (beat >= last.beat) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (beat <= b.beat) {
      const a = pts[i - 1];
      const span = b.beat - a.beat;
      if (span <= 0) return b.value; // coincident points — take the later value
      const t = (beat - a.beat) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value; // unreachable given the guards above
}

/** Read, transform, write one curve file — the `curve point` seam, see docs/curves.md. */
export function editCurveFile(
  dir: string,
  id: string,
  transform: (text: string) => string | null,
): string {
  const rel = `curves/${id}.yaml`;
  const path = join(dir, rel);
  if (!existsSync(path)) throw new Error(`no curve '${id}' (${rel})`);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === null) throw new Error(`nothing to edit in curve '${id}'`);
  if (after !== before) writeFileSync(path, after, "utf8");
  return rel;
}
