// curves.ts — automation curves: a normalised function of song time (curves/<id>.yaml)
// that drives automation, not yet what they're bound to. Two shapes: `lfo` (periodic,
// frequency in cycles/bar) and `custom` (hand-placed points, linear interpolation).
// `polarity` (unipolar 0..1 / bipolar -1..1) is per-curve — see sampleCurve.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportSub } from "@lanes/song/loader";
import { parsePosition } from "@lanes/song/timecode";

export type Polarity = "unipolar" | "bipolar";
export type CurveType = "lfo" | "custom";
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

export type Curve = LfoCurve | CustomCurve;

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
  throw new Error(
    `curve '${id}': unknown type '${type}' (expected "lfo" or "custom")`,
  );
}

// Every curve in curves/, keyed by id; {} when the folder is absent.
// Scaffold curves/<id>.yaml and return its project-relative path.
//
// An LFO, because it is the shape with useful defaults: a `custom` curve with no points
// is not a curve at all, and one invented for you would be a guess about the song. A sine
// at one cycle per bar is immediately audible once bound, which is what tells you the
// binding worked.
//
// Refuses rather than overwrites: a curve someone is already using is not a thing to
// silently replace, and the caller wants to know the name is taken.
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
  const unit =
    curve.type === "lfo"
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

// Bake over the song: a custom curve emits verbatim, an LFO samples on a grid, widened to respect the point cap.
export function bakeCurve(
  curve: Curve,
  num: number,
  den: number,
  songBeats: number,
): BakedCurve {
  const bipolar = curve.polarity === "bipolar";
  let beats: number[];
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
