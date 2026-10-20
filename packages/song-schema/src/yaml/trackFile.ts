// trackFile.ts — editing the PLACEMENTS on a lane, a lane being a node file (nodes/<name>.k7x, docs/trackModules.md).
// Every writer edits a K7Scope at the file's root; reading and validating the file is moduleFile's job.
// A reader would get wrong WHICH list is edited: a lane on one of its alternatives has two (docs/alternatives.md).

import type { K7Path } from "@studio/k7x/ast";
import type { K7Scope } from "@studio/k7x/document";
import { currentAlternative } from "../alternatives";
import { beatsToPosition, parsePosition } from "../timecode";
import type { Placement } from "./placementSchema";
import { spliceList, type TimeSplice } from "./timeSplice";

type Data = Record<string, unknown>;

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The module's own arrangement — attribute set "1", and where a lane with no sets keeps its events. */
const OWN_EVENTS: K7Path = ["events"];

/** Which attribute set is ON — what `eventsIn` addresses and `eventsToEdit` forks into, see docs/laneEdits.md. */
function selectedSet(doc: K7Scope): number {
  const raw = doc.toJS();
  return currentAlternative(isRecord(raw) ? raw : {});
}

const setEvents = (at: number): K7Path => ["alternatives", at - 1, "events"];

const listAt = (doc: K7Scope, path: K7Path): unknown[] | null => {
  const v = doc.getIn(path);
  return Array.isArray(v) ? v : null;
};

/** The events list that is PLAYING: the selected set's own, else the module's. */
function eventsIn(doc: K7Scope): K7Path {
  const at = selectedSet(doc);
  if (at === 0) return OWN_EVENTS;
  const mine = setEvents(at);
  return listAt(doc, mine) ? mine : OWN_EVENTS;
}

/** The events list an edit lands in, forking the selected set's on its first edit — exported for takeFile.ts. */
export function eventsToEdit(doc: K7Scope): K7Path {
  const at = selectedSet(doc);
  if (at === 0) return OWN_EVENTS;
  const mine = setEvents(at);
  if (listAt(doc, mine)) return mine;
  // First edit on a set that inherits: fork what it is PLAYING into it, comments and layout copied (docs/laneEdits.md).
  const own = doc.getNode(OWN_EVENTS);
  const source = own?.kind === "list" ? doc.getSource(OWN_EVENTS) : undefined;
  // A call's own arguments, `events(a, b)`, are a list only once bracketed.
  const inherited =
    own?.kind === "list" && own.form === "args" ? `[${source}]` : source;
  if (inherited) doc.setSourceIn(mine, inherited);
  else doc.setIn(mine, []);
  return mine;
}

/** Set one field on the lane — the module's OWN, whichever set is on; null removes it (docs/laneEdits.md). */
export function setTrackField(
  doc: K7Scope,
  field: string,
  value: unknown,
): void {
  if (value === null) doc.deleteIn([field]);
  else doc.setIn([field], value);
}

/** The index of the placement starting at `start`, or -1 — read off the playing list, see docs/laneEdits.md. */
export function findPlacement(doc: K7Scope, start: string): number {
  const events = listAt(doc, eventsIn(doc)) ?? [];
  return events.findIndex(
    (p) => isRecord(p) && String(p.start ?? "") === start,
  );
}

/** Move the placement at `start` to `to` — a clip drag, or `event move`. */
export function movePlacement(doc: K7Scope, start: string, to: string): void {
  const at = findPlacement(doc, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  // The index came from the list that is PLAYING, and forking copies it in order (docs/laneEdits.md).
  doc.setIn([...eventsToEdit(doc), at, "start"], to);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(doc: K7Scope, start: string): void {
  const at = findPlacement(doc, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  doc.deleteIn([...eventsToEdit(doc), at]);
}

/** Append one placement on a line of its own, the list created when the lane has none. */
function appendPlacement(doc: K7Scope, path: K7Path, value: Data): void {
  if (listAt(doc, path)) doc.addIn(path, value, { inline: true });
  else doc.setIn(path, [value]);
}

/** Append a placement — the receiving half of a cross-lane clip move. */
export function addPlacement(
  doc: K7Scope,
  // No `length`: how long a placement sounds is the material's window times `loop` (docs/laneEdits.md).
  placement: Placement,
): void {
  appendPlacement(doc, eventsToEdit(doc), placement as Data);
}

// --- addressing a placement by POSITION (beats, not strings: "1:1:1", "1:1" and "1" are one position) ---

/** The index of the placement whose `start` parses to `beats`, or -1. */
export function findPlacementAt(
  doc: K7Scope,
  beats: number,
  num: number,
  den: number,
): number {
  const events = listAt(doc, eventsIn(doc)) ?? [];
  return events.findIndex((p) => {
    const start = isRecord(p) ? p.start : undefined;
    try {
      return (
        Math.abs(parsePosition(String(start ?? "1:1:1"), num, den) - beats) <
        1e-6
      );
    } catch {
      return false; // an unparseable start can't match a real position
    }
  });
}

/** The placement at `index` in the playing list, as plain values; null when there is none. */
export function placementAt(doc: K7Scope, index: number): Data | null {
  const p = (listAt(doc, eventsIn(doc)) ?? [])[index];
  return isRecord(p) ? p : null;
}

/** Every placement in the playing list, as plain values — the list to `placementAt`'s one. */
export function placementValues(doc: K7Scope): Data[] {
  return (listAt(doc, eventsIn(doc)) ?? []).map((p) => (isRecord(p) ? p : {}));
}

/** Drop the placement at `index`. */
export function removePlacementAt(doc: K7Scope, index: number): void {
  doc.deleteIn([...eventsToEdit(doc), index]);
}

/** Set (or, with `undefined`, clear) one field of the placement at `index` — the generic form of movePlacementAt. */
export function setPlacementField(
  doc: K7Scope,
  index: number,
  field: string,
  value: string | number | boolean | undefined,
): void {
  const path = eventsToEdit(doc);
  if (value === undefined) doc.deleteIn([...path, index, field]);
  else doc.setIn([...path, index, field], value);
}

/** Copy the placement at `index`, patch the copy and append it — what a SPLIT writes (docs/laneEdits.md). */
export function copyPlacementAt(
  doc: K7Scope,
  index: number,
  patch: Data,
): void {
  const path = eventsToEdit(doc);
  const src = (listAt(doc, path) ?? [])[index];
  if (!isRecord(src)) throw new Error(`no placement at index ${index}`);
  const merged: Data = { ...src };
  for (const [k, v] of Object.entries(patch))
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  appendPlacement(doc, path, merged);
}

/** Rewrite the `start` of the placement at `index`. Everything else it carries stays. */
export function movePlacementAt(doc: K7Scope, index: number, to: string): void {
  doc.setIn([...eventsToEdit(doc), index, "start"], to);
}

/** Every list of placements this file holds — what a change to the song's CLOCK must reach, docs/laneEdits.md. */
function everyEventList(doc: K7Scope): K7Path[] {
  const out: K7Path[] = [];
  if (listAt(doc, OWN_EVENTS)) out.push(OWN_EVENTS);
  (listAt(doc, ["alternatives"]) ?? []).forEach((_, i) => {
    const path = ["alternatives", i, "events"];
    if (listAt(doc, path)) out.push(path);
  });
  return out;
}

/** A placement this lane places `ref` with, and why a loop halving passed it by — docs/laneEdits.md. */
export interface KeptLoop {
  start: string;
  loop: number;
  /** `odd`: it plays an odd number of times. `windowed`: it states a window of its own, which did not double. */
  why: "odd" | "windowed";
}

/** Halve the `loop` of every placement of `ref` that takes the material's WHOLE window — docs/laneEdits.md. */
export function halveSequenceLoops(
  doc: K7Scope,
  ref: string,
): { halved: number; kept: KeptLoop[] } {
  const kept: KeptLoop[] = [];
  let halved = 0;
  for (const path of everyEventList(doc)) {
    (listAt(doc, path) ?? []).forEach((item, i) => {
      if (!isRecord(item) || String(item.ref ?? "") !== ref) return;
      const loop = Number(item.loop ?? 1);
      if (!Number.isInteger(loop) || loop < 2) return;
      const start = String(item.start ?? "1:1:1");
      // A window of its own did not grow with the material's, so halving would halve what plays.
      if (item.from != null || item.to != null) {
        kept.push({ start, loop, why: "windowed" });
        return;
      }
      if (loop % 2) {
        kept.push({ start, loop, why: "odd" });
        return;
      }
      // Back to ONE pass is the default, and the default is written by not writing it.
      if (loop === 2) doc.deleteIn([...path, i, "loop"]);
      else doc.setIn([...path, i, "loop"], loop / 2);
      halved++;
    });
  }
  return { halved, kept };
}

/** Insert or delete time across every placement list, an event straddling the cut going by its `start` — docs/laneEdits.md. */
export function spliceTime(
  doc: K7Scope,
  atBeats: number,
  lenBeats: number,
  mode: "insert" | "delete",
  num: number,
  den: number,
): TimeSplice {
  const splice: TimeSplice = { moved: 0, removed: 0 };
  if (!(lenBeats > 0)) return splice;
  for (const path of everyEventList(doc)) {
    const items = listAt(doc, path) ?? [];
    const startOf = (i: number): number | null => {
      const item = items[i];
      if (!isRecord(item)) return null;
      try {
        return parsePosition(String(item.start ?? "1:1:1"), num, den);
      } catch {
        return null; // an unreadable start is one placement left alone, not a failed splice
      }
    };
    spliceList(
      {
        count: items.length,
        positionOf: startOf,
        remove: (i) => doc.deleteIn([...path, i]),
        move: (i, to) =>
          doc.setIn([...path, i, "start"], beatsToPosition(to, num, den)),
      },
      atBeats,
      lenBeats,
      mode,
      splice,
    );
  }
  return splice;
}
