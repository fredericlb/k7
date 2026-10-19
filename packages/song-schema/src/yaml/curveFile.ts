// curveFile.ts — editing a curve file (`curves/<id>.k7x`) in place, comments and layout kept. Only a
// `custom` curve has anything positioned in song time (`points[].time`); an LFO is periodic and an ADSR is
// fired by note-ons, so neither moves when time is inserted. The reader takes DATA. See docs/curves.md.

import type { K7Scope } from "@studio/k7x/document";
import { beatsToPosition, parsePosition } from "../timecode";

type Data = Record<string, unknown>;

const isMap = (x: unknown): x is Data =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** The points as written, each one a map or not: an index here is an index into the file's list. */
const listOf = (raw: unknown): unknown[] =>
  isMap(raw) && Array.isArray(raw.points) ? raw.points : [];

/** One point's beat, or null when its time does not read — one unreadable point, never a broken file. */
function beatOf(point: unknown, num: number, den: number): number | null {
  if (!isMap(point)) return null;
  try {
    return parsePosition(String(point.time ?? ""), num, den);
  } catch {
    return null;
  }
}

/** The curves made of drawn points: the custom one, and a boolean param's on/off. */
const isDrawn = (type: unknown): boolean =>
  type === "custom" || type === "onoff";

/** Insert or delete time in one curve file, by the point's own position — see docs/curveEdits.md. */
export function spliceCurveTime(
  doc: K7Scope,
  atBeats: number,
  lenBeats: number,
  mode: "insert" | "delete",
  num: number,
  den: number,
): { moved: number; removed: number } {
  const raw = doc.toJS();
  let moved = 0;
  let removed = 0;
  if (!(lenBeats > 0) || !isMap(raw) || !isDrawn(raw.type))
    return { moved, removed };
  const points = listOf(raw);
  const end = atBeats + lenBeats;
  // Descending, so removing one does not shift the address of the next.
  for (let i = points.length - 1; i >= 0; i--) {
    const at = beatOf(points[i], num, den);
    if (at === null) continue;
    if (mode === "delete" && at >= atBeats - 1e-6 && at < end - 1e-6) {
      doc.deleteIn(["points", i]);
      removed++;
      continue;
    }
    const from = mode === "delete" ? end : atBeats;
    if (at < from - 1e-6) continue;
    const to = at + (mode === "delete" ? -lenBeats : lenBeats);
    doc.setIn(["points", i, "time"], beatsToPosition(to, num, den));
    moved++;
  }
  return { moved, removed };
}

/** One point as the file holds it — for a caller counting them, or checking one is there. */
export interface CurvePointAt {
  time: string; // as written
  beat: number; // …and parsed, which is what addresses it
  value: number;
}

/** The points a curve's data declares, in file order, unreadable entries skipped (docs/curveEdits.md). */
export function curvePoints(
  raw: Data,
  num: number,
  den: number,
): CurvePointAt[] {
  const out: CurvePointAt[] = [];
  for (const point of listOf(raw)) {
    const beat = beatOf(point, num, den);
    if (beat === null || !isMap(point)) continue;
    out.push({
      time: String(point.time),
      beat,
      value: Number(point.value ?? 0),
    });
  }
  return out;
}

/** Where a point at `beat` sits in the list, or -1 — matched within 1e-6, like every timecode address. */
function pointIndexAt(
  raw: unknown,
  beat: number,
  num: number,
  den: number,
): number {
  return listOf(raw).findIndex((p) => {
    const at = beatOf(p, num, den);
    return at !== null && Math.abs(at - beat) < 1e-6;
  });
}

/** Put a point at `beat`, IN TIME ORDER and one value per moment — see docs/curveEdits.md. */
export function setCurvePoint(
  doc: K7Scope,
  beat: number,
  value: number,
  num: number,
  den: number,
): void {
  const raw = doc.toJS();
  const type = isMap(raw) ? raw.type : undefined;
  if (!isDrawn(type))
    throw new Error(
      `not a drawn curve — only a \`type: custom\` or \`onoff\` one has points to edit`,
    );
  // An on/off curve holds 0 or 1 and nothing between.
  if (type === "onoff") value = value >= 0.5 ? 1 : 0;
  const v = Math.min(1, Math.max(0, value));
  const at = pointIndexAt(raw, beat, num, den);
  if (at >= 0) {
    doc.setIn(["points", at, "value"], v);
    return;
  }
  const point = { time: beatsToPosition(beat, num, den), value: v };
  if (!Array.isArray((raw as Data).points)) {
    doc.setIn(["points"], [point]);
    return;
  }
  const points = listOf(raw);
  let before = points.length;
  for (let i = 0; i < points.length; i++) {
    const b = beatOf(points[i], num, den);
    if (b !== null && b > beat) {
      before = i;
      break;
    }
  }
  doc.insertIn(["points"], before, point);
}

/** Move the point at `beat` to `toBeat` — remove-then-set, so the list stays sorted; false when there is none (docs/curveEdits.md). */
export function moveCurvePoint(
  doc: K7Scope,
  beat: number,
  toBeat: number,
  value: number | undefined,
  num: number,
  den: number,
): boolean {
  const here = curvePoints((doc.toJS() ?? {}) as Data, num, den).find(
    (p) => Math.abs(p.beat - beat) < 1e-6,
  );
  if (!here || !removeCurvePoint(doc, beat, num, den)) return false;
  setCurvePoint(doc, toBeat, value ?? here.value, num, den);
  return true;
}

/** Take the point at `beat` out. False when there is none — the caller says so by address. */
export function removeCurvePoint(
  doc: K7Scope,
  beat: number,
  num: number,
  den: number,
): boolean {
  const at = pointIndexAt(doc.toJS(), beat, num, den);
  if (at < 0) return false;
  return doc.deleteIn(["points", at]);
}
