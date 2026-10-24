// takeEdit.ts — an event's takes on disk: a comp span picked, a take dropped, a take added, and a
// MIDI take written as a sequence of its own. The event is addressed by where it STARTS, as every
// event verb addresses one; the file half is song-schema's takeFile.ts. See packages/song/docs/takes.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { K7Scope } from "@studio/k7x/document";
import { wsWriteData } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { beatsToPosition } from "@studio/song-schema/timecode";
import {
  addTakeAt,
  removeTakeAt,
  setCompAt,
  setCrossfadeAt,
} from "@studio/song-schema/yaml/takeFile";
import { findPlacementAt } from "@studio/song-schema/yaml/trackFile";
import { songTempo } from "./songTempo";
import { editTrackStruct } from "./trackMix";

/** One edit on the event of `track` starting at `eventBeats`, refused when there is none there. */
function atEvent(
  dir: string,
  track: string,
  eventBeats: number,
  num: number,
  den: number,
  edit: (doc: K7Scope, index: number, tempo: number) => void,
  what: string,
): string {
  const tempo = songTempo(dir);
  return editTrackStruct(
    dir,
    track,
    (doc) => {
      const i = findPlacementAt(doc, eventBeats, num, den, tempo);
      if (i < 0)
        throw new Error(
          `no event at ${beatsToPosition(eventBeats, num, den)} on ${track}`,
        );
      edit(doc, i, tempo);
    },
    what,
  );
}

/** Play `span.take` over `span.from..span.to` (song positions) — the event's own `ref` puts its material back. */
export function setEventComp(
  dir: string,
  track: string,
  eventBeats: number,
  span: { take: string; from: string; to: string },
  num: number,
  den: number,
): string {
  return atEvent(
    dir,
    track,
    eventBeats,
    num,
    den,
    (doc, i, tempo) => setCompAt(doc, i, span, num, den, tempo),
    "comp a take",
  );
}

/** Set the crossfade at the comp seam `at` (a song position), `length` a duration; null removes it. */
export function setEventCrossfade(
  dir: string,
  track: string,
  eventBeats: number,
  at: string,
  length: string | null,
  num: number,
  den: number,
): string {
  return atEvent(
    dir,
    track,
    eventBeats,
    num,
    den,
    (doc, i) => setCrossfadeAt(doc, i, at, length, num, den),
    "set a crossfade",
  );
}

/** Drop take `ref` and every span it played; its material stays on disk, as a deleted clip's does. */
export function removeEventTake(
  dir: string,
  track: string,
  eventBeats: number,
  ref: string,
  num: number,
  den: number,
): string {
  return atEvent(
    dir,
    track,
    eventBeats,
    num,
    den,
    (doc, i) => removeTakeAt(doc, i, ref, num, den),
    "remove a take",
  );
}

/** Add take `ref` starting at `start`, heard over `span` (null: kept but not heard). */
export function addEventTake(
  dir: string,
  track: string,
  eventBeats: number,
  take: { ref: string; start: string },
  span: { from: string; to: string } | null,
  num: number,
  den: number,
): string {
  return atEvent(
    dir,
    track,
    eventBeats,
    num,
    den,
    (doc, i, tempo) => addTakeAt(doc, i, take, span, num, den, tempo),
    "add a take",
  );
}

/** A recorded MIDI pass as `sequences/<id>.k7x`, notes in beats from the take's own start, its window the whole pass. */
export function writeTakeSequence(
  dir: string,
  id: string,
  notes: { t: number; d: number; k: number; v?: number }[],
  lengthBeats: number,
  num: number,
  den: number,
): string {
  const rel = `sequences/${id}.k7x`;
  if (wsExists(join(dir, rel)))
    throw new Error(`sequence '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "sequences"), { recursive: true });
  const to = beatsToPosition(Math.max(lengthBeats, 0), num, den);
  wsWriteData(join(dir, rel), {
    from: "1:1",
    to,
    notes: notes.map((n) => ({
      t: n.t,
      d: n.d,
      k: n.k,
      ...(n.v === undefined ? {} : { v: n.v }),
    })),
  });
  return rel;
}
