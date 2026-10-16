// curvePoint.ts — a curve's points, added, moved and removed, and `curve create`.
// See docs/verbs.md.

import { join } from "node:path";
import { createCurveFile, editCurveFile } from "@studio/song/curves";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { parsePosition } from "@studio/song-schema/timecode";
import {
  curvePoints,
  moveCurvePoint,
  removeCurvePoint,
  setCurvePoint,
} from "@studio/song-schema/yaml/curveFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

/** `curve point add|move|remove <curve> …` — addressed by TIME, `value` is 0..1 of the CURVE; docs/verbs.md. */
async function curvePointCommand(
  a: string,
  h: CommandHost,
  mode: "add" | "move" | "remove",
): Promise<void> {
  const verb = `curve point ${mode}`;
  const parts = splitWords(a);
  const want = mode === "remove" ? 2 : 3;
  if (parts.length < want) {
    h.refuse([
      mode === "add"
        ? `usage: ${verb} <curve> <time> <value>   (value 0..1)`
        : mode === "move"
          ? `usage: ${verb} <curve> <time> <newTime> [value]`
          : `usage: ${verb} <curve> <time>`,
    ]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  const [id, atTc] = parts;
  let atBeats: number;
  try {
    atBeats = parsePosition(atTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  const unit = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
  };
  try {
    const file = join(h.songPath, "curves", `${id}.yaml`);
    const points = curvePoints(wsRead(file), num, den);
    if (mode === "add") {
      const v = unit(parts[2]);
      if (v === undefined) {
        h.refuse([`'${parts[2]}' is not a value between 0 and 1`]);
        return;
      }
      const had = points.some((pt) => Math.abs(pt.beat - atBeats) < 1e-6);
      const rel = editCurveFile(h.songPath, id, (t) =>
        setCurvePoint(t, atBeats, v, num, den),
      );
      await h.reload();
      h.log([
        `${id}: ${had ? "set the point" : "added a point"} at ${atTc} to ${v} (${rel})`,
      ]);
    } else if (mode === "move") {
      let toBeats: number;
      try {
        toBeats = parsePosition(parts[2], num, den);
      } catch (e) {
        h.refuse([`bad timecode: ${(e as Error).message}`]);
        return;
      }
      const rel = editCurveFile(h.songPath, id, (t) =>
        moveCurvePoint(t, atBeats, toBeats, unit(parts[3]), num, den),
      );
      await h.reload();
      h.log([`${id}: the point at ${atTc} is now at ${parts[2]} (${rel})`]);
    } else {
      // The LAST point is not removable: a curve file with none does not load — docs/verbs.md.
      if (points.length <= 1) {
        h.refuse([
          `'${id}' has one point left, and a curve with none does not load`,
          `  to stop automating, use: track automation remove <track> <param>`,
        ]);
        return;
      }
      const rel = editCurveFile(h.songPath, id, (t) =>
        removeCurvePoint(t, atBeats, num, den),
      );
      await h.reload();
      h.log([`${id}: removed the point at ${atTc} (${rel})`]);
    }
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

export const CURVE_POINT_VERBS: Record<string, SidHandler> = {
  "curve.point.add": (a, h) => curvePointCommand(a, h, "add"),
  "curve.point.move": (a, h) => curvePointCommand(a, h, "move"),
  "curve.point.remove": (a, h) => curvePointCommand(a, h, "remove"),
  "curve.create": async (a, h) => {
    const name = a.trim();
    if (!name) {
      h.refuse(["usage: curve new <name>  (e.g. curve new sweep)"]);
      return;
    }
    try {
      const rel = createCurveFile(h.songPath, name);
      h.reload(); // the editor's file tree and the `curve` completions both read the folder
      h.log([`created ${rel}`]);
    } catch (e) {
      h.refuse([`curve new: ${(e as Error).message}`]);
    }
  },
};
