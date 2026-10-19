// curves.ts — automation curves: a normalised function of song time (curves/<id>.k7x)
// that drives automation, not yet what they're bound to. Two shapes: `lfo` (periodic,
// frequency in cycles/bar) and `custom` (hand-placed points, linear interpolation).
// `polarity` (unipolar 0..1 / bipolar -1..1) is per-curve — see sampleCurve.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  CurveCondition,
  CurveCut,
  CurvePolarity,
  CurveSpec,
  LfoShape,
} from "@studio/graph-model";
import type { K7Scope } from "@studio/k7x/document";
import {
  ADSR_DEFAULT_LEVEL,
  adsrMs,
  adsrUnit,
  CURVE_CUTS,
  cutOutput,
  LFO_SHAPES,
} from "@studio/song-schema/curveMath";
import { parseDuration } from "@studio/song-schema/timecode";
import {
  CurveConditionSchema,
  CurveSchema,
} from "@studio/song-schema/yaml/entitySchemas";
import { round6 } from "./curveBake";
import { exportSub } from "./loader";
import { wsEdit, wsWriteData, wsWriteText } from "./yaml/workspaceDoc";

/** The project-relative file a curve lives in. */
const curveRel = (id: string): string => `curves/${id}.k7x`;

/** A curve's points written one a line, so a moved point is a one-line diff. */
const pointLines = (path: readonly (string | number)[]): boolean =>
  path.length === 2 && path[0] === "points";

export {
  type BakedCurve,
  bakeAdsr,
  bakeCurve,
  sampleCurve,
} from "./curveBake";

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

// Scaffold curves/<id>.k7x as an LFO, refusing to overwrite, and return its path — see docs/curves.md.
export function createCurveFile(dir: string, id: string): string {
  // The filename IS the id, so it has to be one a path and a reference can both carry.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid curve name '${id}' — letters, digits, '_' and '-' only`,
    );
  const rel = curveRel(id);
  const path = join(dir, rel);
  if (existsSync(path))
    throw new Error(`curve '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWriteText(
    path,
    [
      `type("lfo")`,
      `shape("sine") // sine | triangle | saw | square`,
      `frequency(1) // cycles per bar`,
      `polarity("unipolar") // unipolar 0..1 | bipolar -1..1`,
      `phase(0) // 0..1 of a cycle`,
      "",
    ].join("\n"),
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

/** Write `curves/<id>.k7x` WHOLE from `raw`, creating or replacing it — the curve editor's save; docs/curves.md. */
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
  const rel = curveRel(id);
  const path = join(dir, rel);
  const created = !existsSync(path);
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWriteData(path, ordered, { inline: pointLines });
  return { rel, created };
}

/** Scaffold `curves/<id>.k7x` as a FLAT custom curve at the param's current value — docs/curves.md. */
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
  const rel = curveRel(id);
  const path = join(dir, rel);
  if (existsSync(path))
    throw new Error(`curve '${id}' already exists (${rel})`);
  const v = round6(Math.min(1, Math.max(0, value)));
  mkdirSync(join(dir, "curves"), { recursive: true });
  wsWriteText(
    path,
    [
      `type("custom")`,
      `polarity("unipolar") // unipolar 0..1 | bipolar -1..1`,
      "points([",
      `  time("1:1:1").value(${v}),`,
      `  time(${JSON.stringify(endTc)}).value(${v}),`,
      "])",
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

/** Run a writer over one curve file — the `curve point` seam; a writer answering false refused, see docs/curves.md. */
export function editCurveFile(
  dir: string,
  id: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: a writer that returns nothing must type-check, and false is its one signal.
  edit: (doc: K7Scope) => boolean | void,
): string {
  const rel = curveRel(id);
  const path = join(dir, rel);
  if (!existsSync(path)) throw new Error(`no curve '${id}' (${rel})`);
  wsEdit(path, (doc) => {
    if (edit(doc.at([])) === false)
      throw new Error(`nothing to edit in curve '${id}'`);
  });
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
