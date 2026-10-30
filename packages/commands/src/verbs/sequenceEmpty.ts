// sequenceEmpty.ts — `sequence empty <tracks> <from> <to>`: an empty sequence over a period, on each
// lane named, placed at the period's start. One command for every lane, so the lot is one undo.
// The one thing a reader would get wrong: `to` is EXCLUSIVE, the bar line the period ends on (docs/verbs.md).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { laneEventsAt, laneFolder } from "@studio/song/chainItemEdit";
import { wsEdit } from "@studio/song/yaml/workspaceDoc";
import { wsExists, wsRemove } from "@studio/song/yaml/workspaceFile";
import { addTrackPlacement } from "@studio/song-edit/trackMix";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import type { CommandHost, SidHandler } from "../commands.ts";

export const SEQUENCE_EMPTY_VERBS: Record<string, SidHandler> = {
  "sequence.empty": sequenceEmptyCommand,
};

async function sequenceEmptyCommand(a: string, h: CommandHost): Promise<void> {
  const [list, fromTc, toTc] = a.trim().split(/\s+/);
  if (!list || !fromTc || !toTc) {
    h.refuse(["usage: sequence empty <track>[,<track>…] <from> <to>"]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator || 4;
  const den = p.timeSigDenominator || 4;
  let from: number;
  let to: number;
  try {
    from = parsePosition(fromTc, num, den);
    to = parsePosition(toTc, num, den);
  } catch (e) {
    h.refuse([`sequence empty: ${(e as Error).message}`]);
    return;
  }
  if (!(to > from)) {
    h.refuse([`sequence empty: ${toTc} is not after ${fromTc}`]);
    return;
  }
  const lanes = list.split(",").filter(Boolean);
  // Every lane checked before anything is written: a refusal leaves the project as it was.
  const unknown = lanes.filter(
    (l) => !p.tracks.some((t) => t.id === l || t.name === l),
  );
  if (unknown.length) {
    h.refuse([
      `sequence empty: no track ${unknown.map((u) => `"${u}"`).join(", ")}`,
    ]);
    return;
  }
  try {
    const made = writeEmptySequences(h.songPath, lanes, from, to, num, den);
    h.log(made.map((m) => `+ sequence ${m.id} on ${m.lane} at ${m.at}`));
    await h.reload();
  } catch (e) {
    h.refuse([`sequence empty: ${(e as Error).message}`]);
  }
}

/** An empty sequence `to - from` beats long on each lane, placed at `from`; a lane that refuses takes every file back. */
export function writeEmptySequences(
  dir: string,
  lanes: readonly string[],
  from: number,
  to: number,
  num: number,
  den: number,
): { id: string; lane: string; at: string }[] {
  // Every lane's file found before anything is written: half a selection filled is not what was asked.
  const missing = lanes.filter((l) => !laneEventsAt(dir, l));
  if (missing.length)
    throw new Error(
      `no file in ${laneFolder(dir)}/ for ${missing.map((l) => `"${l}"`).join(", ")}`,
    );
  const at = beatsToPosition(from, num, den);
  const end = beatsToPosition(to - from, num, den);
  const made: { id: string; lane: string; at: string; file: string }[] = [];
  mkdirSync(join(dir, "sequences"), { recursive: true });
  try {
    for (const lane of lanes) {
      // A lane id may hold characters a sequence filename may not.
      const base = /^[A-Za-z0-9_.-]+$/.test(lane) ? `${lane}-seq` : "seq";
      let n = 1;
      while (wsExists(join(dir, "sequences", `${base}-${n}.k7x`))) n++;
      const id = `${base}-${n}`;
      const file = join(dir, "sequences", `${id}.k7x`);
      wsEdit(
        file,
        (doc) => {
          doc.at([]).setIn(["from"], "1:1");
          doc.at([]).setIn(["to"], end);
        },
        { create: true },
      );
      made.push({ id, lane, at, file });
      addTrackPlacement(dir, lane, id, at);
    }
  } catch (e) {
    // A write that failed after the check: the sequences written so far go with it.
    for (const m of made) wsRemove(m.file);
    throw e;
  }
  return made.map(({ id, lane, at: where }) => ({ id, lane, at: where }));
}
