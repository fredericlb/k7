// curve.ts — `curve set <name> <json>`: a curve written WHOLE, created or replaced, from the fields a
// person set in the curve editor (`ui curve`). One command, so one save is one undo; the file is the
// curve's, and the editor holds every field of it. See packages/song/docs/curves.md.

import { writeCurveFile } from "@studio/song/curves";
import type { CommandHost, SidHandler } from "../commands.ts";

export const CURVE_VERBS: Record<string, SidHandler> = {
  "curve.set": (a, h) => setCurve(a, h),
};

const USAGE =
  'usage: curve set <name> <json> (e.g. curve set wobble {"type":"lfo","shape":"sine","frequency":1,"phase":0,"amplitude":1})';

async function setCurve(arg: string, h: CommandHost): Promise<void> {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(arg.trim());
  if (!m) {
    h.refuse([USAGE]);
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(m[2]);
  } catch {
    h.refuse([USAGE]);
    return;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    h.refuse([USAGE]);
    return;
  }
  try {
    const { rel, created } = writeCurveFile(
      h.songPath,
      m[1],
      raw as Record<string, unknown>,
    );
    await h.reload();
    h.log([`${created ? "created" : "wrote"} ${rel}`]);
  } catch (e) {
    h.refuse([`curve set: ${(e as Error).message}`]);
  }
}
