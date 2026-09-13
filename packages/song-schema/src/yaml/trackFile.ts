// trackFile.ts — editing the PLACEMENTS on a lane, a lane being a node file
// (nodes/<name>.yaml, see docs/trackModules.md). The app's most frequent edit: every clip
// drag writes a placement's `start`. Reading and validating the file is moduleFile's job, since
// a lane is an ordinary module; what is here is the clip list — and WHICH list, since a lane on
// one of its alternatives has two (docs/alternatives.md).

import { isMap, isSeq, parseDocument } from "yaml";
import { currentAlternative } from "../alternatives";
import { beatsToPosition, parsePosition } from "../timecode";
import { quoteTimecodes } from "./moduleFile";
import type { Placement } from "./placementSchema";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

// A raw object stored via setIn stays plain until stringify, invisible to the quoting visitor — createNode first.
function put(
  doc: ReturnType<typeof parseDocument>,
  path: (string | number)[],
  value: unknown,
): void {
  const node =
    value !== null && typeof value === "object" ? doc.createNode(value) : value;
  doc.setIn(path, node);
}

/** The module's own arrangement — attribute set "1", and where a lane with no sets keeps its events. */
const OWN_EVENTS: (string | number)[] = ["events"];

/** Which attribute set is ON — what `eventsIn` addresses and `eventsToEdit` forks into, see docs/laneEdits.md. */
function selectedSet(doc: ReturnType<typeof parseDocument>): number {
  return currentAlternative((doc.toJS() ?? {}) as Record<string, unknown>);
}

function setEvents(at: number): (string | number)[] {
  return ["alternatives", at - 1, "events"];
}

function eventsIn(doc: ReturnType<typeof parseDocument>): (string | number)[] {
  const at = selectedSet(doc);
  if (at === 0) return OWN_EVENTS;
  const mine = setEvents(at);
  return isSeq(doc.getIn(mine)) ? mine : OWN_EVENTS;
}

function eventsToEdit(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[] {
  const at = selectedSet(doc);
  if (at === 0) return OWN_EVENTS;
  const mine = setEvents(at);
  if (isSeq(doc.getIn(mine))) return mine;
  // First edit on a set that inherits: fork what it is PLAYING into it — see docs/laneEdits.md.
  const inherited = doc.getIn(OWN_EVENTS);
  doc.setIn(mine, isSeq(inherited) ? inherited.clone() : doc.createNode([]));
  // An empty set is written `- {}`, whose flow map would arrive as one 400-character row.
  const entry = doc.getIn(["alternatives", at - 1]);
  if (isMap(entry)) entry.flow = false;
  const forked = doc.getIn(mine);
  if (isSeq(forked)) forked.flow = false;
  flowPlacements(doc, mine);
  return mine;
}

/** Set one field on the lane — the module's OWN, whichever set is on, see docs/laneEdits.md. */
export function setTrackField(
  text: string,
  field: string,
  value: unknown,
): string {
  const doc = parseDocument(text, OPTS);
  if (value === null) doc.deleteIn([field]);
  else put(doc, [field], value);
  flowPlacements(doc, eventsIn(doc));
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** One placement per line — the shape the file already uses, kept on every write. */
function flowPlacements(
  doc: ReturnType<typeof parseDocument>,
  path: (string | number)[],
): void {
  const events = doc.getIn(path);
  if (!isSeq(events)) return;
  for (const p of events.items)
    if (p && typeof p === "object") (p as { flow?: boolean }).flow = true;
}

/** The index of the placement starting at `start`, or -1 — read off the DOCUMENT, see docs/laneEdits.md. */
export function findPlacement(text: string, start: string): number {
  const doc = parseDocument(text, OPTS);
  const path = eventsIn(doc);
  const events = doc.getIn(path);
  if (!isSeq(events)) return -1;
  return events.items.findIndex(
    (_p, i) => String(doc.getIn([...path, i, "start"]) ?? "") === start,
  );
}

/** Move the placement at `start` to `to` — a clip drag, or `event move`. */
export function movePlacement(text: string, start: string, to: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  // The index came from the list that is PLAYING, and forking copies it in order (docs/laneEdits.md).
  doc.setIn([...eventsToEdit(doc), at, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(text: string, start: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn([...eventsToEdit(doc), at]);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Append a placement — the receiving half of a cross-lane clip move. */
export function addPlacement(
  text: string,
  // No `length`: how long a placement sounds is the material's window times `loop` (docs/laneEdits.md).
  placement: Placement,
): string {
  const doc = parseDocument(text, OPTS);
  const path = eventsToEdit(doc);
  const events = doc.getIn(path);
  const node = doc.createNode(placement);
  node.flow = true; // one placement per line, as the file already writes them
  if (isSeq(events)) events.items.push(node);
  else doc.setIn(path, doc.createNode([node]));
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

// --- addressing a placement by POSITION (beats, not strings: "1:1:1", "1:1" and "1" are one position) ---

/** The index of the placement whose `start` parses to `beats`, or -1. */
export function findPlacementAt(
  text: string,
  beats: number,
  num: number,
  den: number,
): number {
  const doc = parseDocument(text, OPTS);
  const path = eventsIn(doc);
  const events = doc.getIn(path);
  if (!isSeq(events)) return -1;
  return events.items.findIndex((_p, i) => {
    const start = doc.getIn([...path, i, "start"]);
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

/** The placement at `index` as PLAIN VALUES — a node cannot cross documents, see docs/laneEdits.md. */
export function placementAt(
  text: string,
  index: number,
): Record<string, unknown> | null {
  const doc = parseDocument(text, OPTS);
  const path = eventsIn(doc);
  const events = doc.getIn(path);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return null;
  const node = doc.getIn([...path, index], false) as
    | { toJSON?: () => unknown }
    | undefined;
  return (node?.toJSON?.() as Record<string, unknown> | undefined) ?? null;
}

/** Every placement in `text`, as PLAIN VALUES — the list to `placementAt`'s one. */
export function placementValues(text: string): Record<string, unknown>[] {
  const doc = parseDocument(text, OPTS);
  const events = doc.getIn(eventsIn(doc));
  if (!isSeq(events)) return [];
  return events.items.map(
    (it) =>
      ((it as { toJSON?: () => unknown })?.toJSON?.() ?? {}) as Record<
        string,
        unknown
      >,
  );
}

/** Drop the placement at `index`. */
export function removePlacementAt(text: string, index: number): string {
  const doc = parseDocument(text, OPTS);
  doc.deleteIn([...eventsToEdit(doc), index]);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Set (or, with `undefined`, clear) one field of the placement at `index` — the generic form of movePlacementAt. */
export function setPlacementField(
  text: string,
  index: number,
  field: string,
  value: string | number | boolean | undefined,
): string {
  const doc = parseDocument(text, OPTS);
  const path = eventsToEdit(doc);
  if (value === undefined) doc.deleteIn([...path, index, field]);
  else doc.setIn([...path, index, field], value);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Copy the placement at `index`, patch the copy and append it — what a SPLIT writes (docs/laneEdits.md). */
export function copyPlacementAt(
  text: string,
  index: number,
  patch: Record<string, unknown>,
): string {
  const doc = parseDocument(text, OPTS);
  const path = eventsToEdit(doc);
  const events = doc.getIn(path);
  if (!isSeq(events) || index < 0 || index >= events.items.length)
    throw new Error(`no placement at index ${index}`);
  const src =
    ((doc.getIn([...path, index]) as { toJSON?: () => unknown })?.toJSON?.() as
      | Record<string, unknown>
      | undefined) ?? {};
  const merged: Record<string, unknown> = { ...src };
  for (const [k, v] of Object.entries(patch))
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  const copy = doc.createNode(merged);
  copy.flow = true; // one placement per line, as the file already writes them
  events.items.push(copy);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Rewrite the `start` of the placement at `index`. Everything else it carries stays. */
export function movePlacementAt(
  text: string,
  index: number,
  to: string,
): string {
  const doc = parseDocument(text, OPTS);
  doc.setIn([...eventsToEdit(doc), index, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Every list of placements this file holds — what a change to the song's CLOCK must reach, docs/laneEdits.md. */
export function everyEventList(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[][] {
  const out: (string | number)[][] = [];
  const push = (path: (string | number)[]): void => {
    if (isSeq(doc.getIn(path))) out.push(path);
  };
  push(["events"]);
  const alts = doc.getIn(["alternatives"]);
  if (isSeq(alts)) alts.items.forEach((_, i) => push(["alternatives", i, "events"]));
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
  text: string,
  ref: string,
): { text: string; halved: number; kept: KeptLoop[] } {
  const doc = parseDocument(text, OPTS);
  const kept: KeptLoop[] = [];
  let halved = 0;
  for (const path of everyEventList(doc)) {
    const seq = doc.getIn(path);
    if (!isSeq(seq)) continue;
    for (const item of seq.items) {
      if (!isMap(item) || String(item.get("ref") ?? "") !== ref) continue;
      const loop = Number(item.get("loop") ?? 1);
      if (!Number.isInteger(loop) || loop < 2) continue;
      const start = String(item.get("start") ?? "1:1:1");
      // A window of its own did not grow with the material's, so halving would halve what plays.
      if (item.get("from") != null || item.get("to") != null) {
        kept.push({ start, loop, why: "windowed" });
        continue;
      }
      if (loop % 2) {
        kept.push({ start, loop, why: "odd" });
        continue;
      }
      // Back to ONE pass is the default, and the default is written by not writing it.
      if (loop === 2) item.delete("loop");
      else item.set("loop", loop / 2);
      halved++;
    }
  }
  if (!halved) return { text, halved, kept };
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), halved, kept };
}

/** What `spliceTime` did to one lane — for a caller reporting it, and for refusing a no-op. */
export interface TimeSplice {
  moved: number;
  removed: number;
}

/** Insert or delete time across every placement list, an event straddling the cut going by its `start` — docs/laneEdits.md. */
export function spliceTime(
  text: string,
  atBeats: number,
  lenBeats: number,
  mode: "insert" | "delete",
  num: number,
  den: number,
): { text: string; splice: TimeSplice } {
  const doc = parseDocument(text, OPTS);
  const splice: TimeSplice = { moved: 0, removed: 0 };
  if (!(lenBeats > 0)) return { text, splice };
  const end = atBeats + lenBeats;
  for (const path of everyEventList(doc)) {
    const seq = doc.getIn(path);
    if (!isSeq(seq)) continue;
    // Descending, so removing one does not shift the address of the next.
    for (let i = seq.items.length - 1; i >= 0; i--) {
      const item = seq.items[i];
      if (!isMap(item)) continue;
      const raw = item.get("start");
      let start: number;
      try {
        start = parsePosition(String(raw ?? "1:1:1"), num, den);
      } catch {
        continue; // an unreadable start is one placement left alone, not a failed splice
      }
      if (mode === "delete" && start >= atBeats - 1e-6 && start < end - 1e-6) {
        seq.items.splice(i, 1);
        splice.removed++;
        continue;
      }
      const from = mode === "delete" ? end : atBeats;
      if (start < from - 1e-6) continue;
      item.set(
        "start",
        beatsToPosition(
          start + (mode === "delete" ? -lenBeats : lenBeats),
          num,
          den,
        ),
      );
      splice.moved++;
    }
  }
  if (!splice.moved && !splice.removed) return { text, splice };
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), splice };
}
