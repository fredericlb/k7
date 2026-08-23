// curveFile.ts — editing `curves/<id>.yaml` in place, comments and layout kept. Only a `custom`
// curve has anything positioned in song time (`points[].time`); an LFO is periodic and an ADSR is
// fired by note-ons, so neither moves when time is inserted. See docs/curves.md.

import { isMap, isSeq, parseDocument } from "yaml";
import { beatsToPosition, parsePosition } from "../timecode";
import { quoteTimecodes } from "./moduleFile";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

/** Insert or delete time in one curve file, by the point's own position — see docs/curveEdits.md. */
export function spliceCurveTime(
  text: string,
  atBeats: number,
  lenBeats: number,
  mode: "insert" | "delete",
  num: number,
  den: number,
): { text: string; moved: number; removed: number } {
  const doc = parseDocument(text, OPTS);
  let moved = 0;
  let removed = 0;
  const points = doc.getIn(["points"]);
  if (!(lenBeats > 0) || doc.get("type") !== "custom" || !isSeq(points))
    return { text, moved, removed };
  const end = atBeats + lenBeats;
  // Descending, so removing one does not shift the address of the next.
  for (let i = points.items.length - 1; i >= 0; i--) {
    const item = points.items[i];
    if (!isMap(item)) continue;
    let at: number;
    try {
      at = parsePosition(String(item.get("time") ?? ""), num, den);
    } catch {
      continue; // an unreadable time is one point left alone, not a failed splice
    }
    if (mode === "delete" && at >= atBeats - 1e-6 && at < end - 1e-6) {
      points.items.splice(i, 1);
      removed++;
      continue;
    }
    const from = mode === "delete" ? end : atBeats;
    if (at < from - 1e-6) continue;
    item.set(
      "time",
      beatsToPosition(
        at + (mode === "delete" ? -lenBeats : lenBeats),
        num,
        den,
      ),
    );
    moved++;
  }
  if (!moved && !removed) return { text, moved, removed };
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), moved, removed };
}

/** One point as the file holds it — for a caller counting them, or checking one is there. */
export interface CurvePointAt {
  time: string; // as written
  beat: number; // …and parsed, which is what addresses it
  value: number;
}

/** The points a curve file declares, in file order, unreadable entries skipped (docs/curveEdits.md). */
export function curvePoints(
  text: string,
  num: number,
  den: number,
): CurvePointAt[] {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return [];
  }
  const points = doc.getIn(["points"]);
  if (!isSeq(points)) return [];
  const out: CurvePointAt[] = [];
  points.items.forEach((item, i) => {
    if (!isMap(item)) return;
    const time = String(item.get("time") ?? "");
    try {
      out.push({
        time,
        beat: parsePosition(time, num, den),
        value: Number(doc.getIn(["points", i, "value"]) ?? 0),
      });
    } catch {
      /* one unreadable point, not a broken file */
    }
  });
  return out;
}

/** Where a point at `beat` sits in the seq, or -1 — matched within 1e-6, like every timecode address. */
function pointIndexAt(
  points: ReturnType<typeof parseDocument>["contents"],
  doc: ReturnType<typeof parseDocument>,
  beat: number,
  num: number,
  den: number,
): number {
  if (!isSeq(points)) return -1;
  return points.items.findIndex((item, i) => {
    if (!isMap(item)) return false;
    try {
      return (
        Math.abs(
          parsePosition(
            String(doc.getIn(["points", i, "time"]) ?? ""),
            num,
            den,
          ) - beat,
        ) < 1e-6
      );
    } catch {
      return false;
    }
  });
}

/** Put a point at `beat`, IN TIME ORDER and one value per moment — see docs/curveEdits.md. */
export function setCurvePoint(
  text: string,
  beat: number,
  value: number,
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, OPTS);
  if (doc.get("type") !== "custom")
    throw new Error(
      `not a drawn curve — only a \`type: custom\` one has points to edit`,
    );
  if (!isSeq(doc.getIn(["points"]))) doc.setIn(["points"], doc.createNode([]));
  const points = doc.getIn(["points"]);
  if (!isSeq(points)) return text;
  const v = Math.min(1, Math.max(0, value));
  const at = pointIndexAt(points, doc, beat, num, den);
  if (at >= 0) {
    doc.setIn(["points", at, "value"], v);
  } else {
    const node = doc.createNode({
      time: beatsToPosition(beat, num, den),
      value: v,
    });
    // Flow style, matching what every hand-written and generated curve looks like.
    if (isMap(node)) node.flow = true;
    let before = points.items.length;
    for (let i = 0; i < points.items.length; i++) {
      let b: number;
      try {
        b = parsePosition(
          String(doc.getIn(["points", i, "time"]) ?? ""),
          num,
          den,
        );
      } catch {
        continue;
      }
      if (b > beat) {
        before = i;
        break;
      }
    }
    points.items.splice(before, 0, node);
  }
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Move the point at `beat` to `toBeat` — remove-then-set, so the list stays sorted (docs/curveEdits.md). */
export function moveCurvePoint(
  text: string,
  beat: number,
  toBeat: number,
  value: number | undefined,
  num: number,
  den: number,
): string | null {
  const here = curvePoints(text, num, den).find(
    (p) => Math.abs(p.beat - beat) < 1e-6,
  );
  if (!here) return null;
  const dropped = removeCurvePoint(text, beat, num, den);
  if (dropped === null) return null;
  return setCurvePoint(dropped, toBeat, value ?? here.value, num, den);
}

/** Take the point at `beat` out. Null when there is none — the caller says so by address. */
export function removeCurvePoint(
  text: string,
  beat: number,
  num: number,
  den: number,
): string | null {
  const doc = parseDocument(text, OPTS);
  const points = doc.getIn(["points"]);
  if (!isSeq(points)) return null;
  const at = pointIndexAt(points, doc, beat, num, den);
  if (at < 0) return null;
  points.items.splice(at, 1);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}
