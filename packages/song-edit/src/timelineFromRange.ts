// timelineFromRange.ts — the events of ONE lane starting in a range, moved into a new timeline and
// replaced by one event of it, so the lane sounds as it did. What a reader gets wrong: the range
// takes events by START, as `events move` does; one starting before it stays where it is.
// See @studio/song docs/timelines.md.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { laneEventsAt } from "@studio/song/chainItemEdit";
import { wsText, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import {
  beatsToDuration,
  beatsToPosition,
  parsePosition,
} from "@studio/song-schema/timecode";
import { timelineLaneOf } from "@studio/song-schema/timelineLane";
import { shiftTakes } from "@studio/song-schema/yaml/takeFile";
import {
  addPlacement,
  placementValues,
  removePlacementAt,
} from "@studio/song-schema/yaml/trackFile";
import { editTrackStruct } from "./trackMix";

/** Move lane `laneId`'s events starting in `[from, end)` (beats) into timeline `name`; how many moved, 0 writing nothing. */
export function timelineFromRange(
  dir: string,
  laneId: string,
  from: number,
  end: number,
  num: number,
  den: number,
  name: string,
): number {
  const file = join(dir, "timelines", `${name}.k7x`);
  if (wsExists(file)) throw new Error(`timeline '${name}' already exists`);
  const at = laneEventsAt(dir, laneId);
  if (!at) throw new Error(`track "${laneId}" has no file`);
  const startOf = (p: Record<string, unknown>): number | null => {
    try {
      return parsePosition(String(p.start ?? "1:1"), num, den);
    } catch {
      return null;
    }
  };
  const inRange = (p: Record<string, unknown>) => {
    const s = startOf(p);
    return s !== null && s >= from - 1e-9 && s < end - 1e-9;
  };
  const moved = placementValues(
    new K7Document(wsText(at.path)).at(at.base),
  ).filter(inRange);
  if (!moved.length) return 0;
  // Its lane is named after the one it leaves; a timeline's own lane leaves the part after its `>`.
  const lane = (timelineLaneOf(laneId)?.lane ?? laneId).replace(
    /[^A-Za-z0-9_.-]/g,
    "-",
  );
  const events = moved.map((p) => {
    const s = startOf(p) as number;
    return {
      ...shiftTakes(p, -from, num, den),
      start: beatsToPosition(s - from, num, den),
    };
  });
  mkdirSync(join(dir, "timelines"), { recursive: true });
  wsWriteText(
    file,
    stringify({
      length: beatsToDuration(end - from, num, den),
      lanes: [{ lane, events }],
    }),
  );
  try {
    editTrackStruct(
      dir,
      laneId,
      (doc) => {
        const all = placementValues(doc);
        for (let i = all.length - 1; i >= 0; i--)
          if (inRange(all[i])) removePlacementAt(doc, i);
        addPlacement(doc, {
          ref: name,
          start: beatsToPosition(from, num, den),
        });
      },
      `move a range into timeline "${name}"`,
    );
  } catch (e) {
    // The lane kept its events: a timeline holding copies of them would play them twice once placed.
    rmSync(file, { force: true });
    throw e;
  }
  return moved.length;
}
