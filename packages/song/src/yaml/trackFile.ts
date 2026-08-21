// trackFile.ts — editing the PLACEMENTS on a lane, now that a lane is a node file
// (nodes/<name>.yaml, see docs/trackModules.md). The app's most frequent edit: every clip
// drag writes a placement's `start`. Reading and validating the file is moduleFile's job, since
// a lane is an ordinary module; what is here is the clip list — and WHICH list, since a lane on
// one of its alternatives has two (docs/alternatives.md).

import { isMap, isSeq, parseDocument } from "yaml";
import { currentAlternative } from "../alternatives";
import { beatsToPosition, parsePosition } from "../timecode";
import { quoteTimecodes } from "./moduleFile";

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

/**
 * WHERE this file's events are, and it is a CHOICE again.
 *
 * A lane is a module node, so its takes are that module's attribute sets: `events:` can exist at
 * the top of the file (set "1") and once more inside each entry under `alternatives:`. Which one
 * an edit means is whichever set is ON — and reading and writing do not always agree, which is
 * why there are two of these:
 *
 * - `eventsIn` is what an edit ADDRESSES. A set that states no `events:` of its own inherits the
 *   module's, so that is what is on screen and what a clip is picked out of.
 * - `eventsToEdit` is where the edit LANDS: always the selected set, forking the inherited list
 *   into it on the first write.
 *
 * That fork is the whole fix. Every edit here used to write `["events"]` flat, so dragging a clip
 * while on take 2 rewrote take 1 — the arrangement you were not looking at — and the two takes
 * were never separate documents at all. See ../docs/alternatives.md.
 */
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
  // First edit on a set that was inheriting: fork what it was PLAYING into it, so the edit
  // changes what you see and set 1 keeps what it had. `clone()` rather than a rebuild from plain
  // values, because it is a deep copy that brings each placement's own comments with it.
  const inherited = doc.getIn(OWN_EVENTS);
  doc.setIn(mine, isSeq(inherited) ? inherited.clone() : doc.createNode([]));
  // An empty set was written `- {}`, and a flow map keeps everything inside it on its own line —
  // so a forked arrangement would arrive as one 400-character row. These files are hand-edited
  // and they are in git: the set opens out, and its placements stay one per line as everywhere.
  const entry = doc.getIn(["alternatives", at - 1]);
  if (isMap(entry)) entry.flow = false;
  const forked = doc.getIn(mine);
  if (isSeq(forked)) forked.flow = false;
  flowPlacements(doc, mine);
  return mine;
}

/**
 * Set one field on the lane — what a colour picker writes.
 *
 * The module's OWN field, whichever set is on, and that is deliberate: `TrackFields` is `color`
 * and `disabled`, which describe the lane rather than the take. A set may still override either
 * by hand; nothing here writes one there.
 */
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

// --- takes: the OTHER lists of placements this lane keeps (docs/takes.md) --------------
//
// A take is the same thing `events:` is — a list of placements — put aside. So all three writers
// below are moves between two seqs, never a rebuild: a placement carries its own comments and
// its own spelling, and it should read the same after being set aside as it did before.

/** The module's own takes — set "1"'s, and where a lane with no alternatives keeps them. */
const OWN_TAKES: (string | number)[] = ["takes"];

/** Where this file's takes are, on the same rule `eventsToEdit` follows: the SELECTED set's, so
 *  an alternative's takes are its own. Created empty on first use. */
function takesToEdit(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[] {
  const at = selectedSet(doc);
  const path = at === 0 ? OWN_TAKES : ["alternatives", at - 1, "takes"];
  if (!isSeq(doc.getIn(path))) doc.setIn(path, doc.createNode([]));
  return path;
}

/** The takes this file holds, as plain values — for a caller counting them or naming one. */
export function takeValues(
  text: string,
): { name?: string; events: unknown[] }[] {
  const doc = parseDocument(text, OPTS);
  const takes = doc.getIn(takesPathFor(doc));
  if (!isSeq(takes)) return [];
  return takes.items.map((t) => {
    const v = (t as { toJSON?: () => unknown })?.toJSON?.() ?? t;
    const o = (v ?? {}) as { name?: string; events?: unknown[] };
    return { ...(o.name ? { name: o.name } : {}), events: o.events ?? [] };
  });
}

/** Where the takes to READ are: the selected set's when it has any, else the module's own. */
function takesPathFor(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[] {
  const at = selectedSet(doc);
  if (at === 0) return OWN_TAKES;
  const mine = ["alternatives", at - 1, "takes"];
  return isSeq(doc.getIn(mine)) ? mine : OWN_TAKES;
}

/**
 * Move what the lane is playing into a NEW take, leaving it empty.
 *
 * What recording over an event does before the new one is placed. The events are MOVED — the
 * same nodes, appended to `takes:` — so a take reads exactly like the arrangement it was.
 * A lane holding nothing makes no take: an empty one would be a row that says nothing.
 */
export function pushEventsToTake(text: string, name?: string): string {
  const doc = parseDocument(text, OPTS);
  const eventsPath = eventsToEdit(doc);
  const events = doc.getIn(eventsPath);
  if (!isSeq(events) || !events.items.length) return text;
  const takes = doc.getIn(takesToEdit(doc));
  if (!isSeq(takes)) return text;
  const entry = doc.createNode({ ...(name ? { name } : {}), events: [] });
  entry.flow = false;
  takes.items.push(entry);
  doc.setIn([...takesToEdit(doc), takes.items.length - 1, "events"], events);
  doc.setIn(eventsPath, doc.createNode([]));
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/**
 * Swap take `n` (1-based) with what the lane is playing — one exchange, both ways at once.
 *
 * The lane's arrangement becomes take `n` and take `n` becomes the arrangement, which is what
 * makes this reversible by running it again: nothing is lost by looking at another take. An `n`
 * nothing answers to throws rather than writing, so a stale menu cannot empty a lane.
 */
export function selectTake(text: string, n: number): string {
  const doc = parseDocument(text, OPTS);
  const takesPath = takesToEdit(doc);
  const takes = doc.getIn(takesPath);
  if (!isSeq(takes) || n < 1 || n > takes.items.length)
    throw new Error(`no take ${n} on this lane`);
  const eventsPath = eventsToEdit(doc);
  const wasPlaying = doc.getIn(eventsPath);
  const wasTake = doc.getIn([...takesPath, n - 1, "events"]);
  doc.setIn(eventsPath, isSeq(wasTake) ? wasTake : doc.createNode([]));
  doc.setIn(
    [...takesPath, n - 1, "events"],
    isSeq(wasPlaying) ? wasPlaying : doc.createNode([]),
  );
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Remove take `n` (1-based). The events it held go with it — a take is where they live. */
export function removeTake(text: string, n: number): string {
  const doc = parseDocument(text, OPTS);
  const takesPath = takesToEdit(doc);
  const takes = doc.getIn(takesPath);
  if (!isSeq(takes) || n < 1 || n > takes.items.length)
    throw new Error(`no take ${n} on this lane`);
  takes.items.splice(n - 1, 1);
  // The last one leaves no empty list behind: absent is how a lane with no takes reads.
  if (!takes.items.length) doc.deleteIn(takesPath);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/**
 * Drop every take, keeping what the lane is playing. The end of choosing between them.
 *
 * The events inside go with them, exactly as `removeTake` takes one take's: a take is where
 * those placements live. Deliberately one act rather than a loop of `removeTake` at the call
 * site — "keep this one" is a decision about the whole list, and half of it applied is a state
 * nobody asked for.
 */
export function removeAllTakes(text: string): string {
  const doc = parseDocument(text, OPTS);
  const path = takesPathFor(doc);
  if (!isSeq(doc.getIn(path))) return text;
  doc.deleteIn(path);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/**
 * The index of the placement starting at `start`, or -1. How the app addresses one.
 *
 * Reads the DOCUMENT rather than a validated lane, for the same reason `placementValues` does: a
 * file with one bad field elsewhere still has events you can point at, and refusing a drag because
 * something unrelated is wrong would be a worse failure than the one being reported.
 */
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
  // The index came from the list that is PLAYING; forking copies it in order, so it still points
  // at the same placement. Every index-taking edit below rests on that.
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
  // No `length`: how long a placement sounds is the material's window times `loop` (see PlacementSchema).
  placement: { ref: string; start?: string; loop?: number },
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

/**
 * The placement at `index`, as PLAIN VALUES — for carrying one to another lane.
 *
 * `toJSON()` and not the document node, and the difference is not cosmetic: this used to return
 * the node (`getIn(…, false)`), which its own summary and its return type both denied. Its one
 * caller — `movePlacementToTrack` — spreads what it gets, and spreading a YAMLMap copies the
 * MAP's fields rather than the placement's, so dragging an event onto another lane wrote
 * `{ items: […], flow: true, range: […] }` into the file. The lane then failed to compile and
 * took the whole timeline with it, which is a long way from a drag.
 *
 * A node cannot cross documents anyway — it carries a `range` into offsets of the file it was
 * parsed from — so there was never a reader that wanted one.
 */
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

/**
 * Every placement in `text`, as PLAIN VALUES.
 *
 * The list to `placementAt`'s one, and both hand back plain values now: a document node cannot
 * cross into another file (its `range` points at offsets of the one it was parsed from), and the
 * one caller that tried spread it into the shape of a YAMLMap instead — see `placementAt`.
 */
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

/** Set (or, with `undefined`, clear) one field of the placement at `index`. The generic
 *  form movePlacementAt is the `start` case of — used for `disabled` and for `loop`.
 *  quoteTimecodes then re-quotes whatever timecode was written, so a caller never has to
 *  remember the rule. */
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

/**
 * Copy the placement at `index`, apply `patch` to the copy, and append it — what a SPLIT writes
 * for the second half.
 *
 * A copy rather than a fresh `{ ref, start }`, because everything else the placement carries is
 * still true of the half that was cut off: its `warp: false`, its `disabled`, its `to`, and
 * whatever a later schema adds. Rebuilding it from the two fields this knows about would quietly
 * drop the rest, and the loss would only show when the tail played differently from the head.
 *
 * `undefined` in the patch CLEARS a field, the same rule `setPlacementField` follows. The copy is
 * built from the placement's VALUES, so a comment written beside the original stays with the
 * original — which is right: it was written about that event, and the second half is new.
 */
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

/**
 * Every list of placements this file holds, wherever it keeps them.
 *
 * Not `eventsToEdit`'s question, which is "where does an edit to what is PLAYING go" and answers
 * with the selected set alone. Inserting time is not an edit to the arrangement — it is a change
 * to the song's clock — so it has to reach what is playing, every take of it, and every
 * alternative's own events and takes. An alternative you switch to next week has to still line up
 * with the markers.
 */
function everyEventList(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[][] {
  const out: (string | number)[][] = [];
  const push = (path: (string | number)[]): void => {
    if (isSeq(doc.getIn(path))) out.push(path);
  };
  const withTakes = (base: (string | number)[]): void => {
    push([...base, "events"]);
    const takes = doc.getIn([...base, "takes"]);
    if (isSeq(takes))
      takes.items.forEach((_, i) => push([...base, "takes", i, "events"]));
  };
  withTakes([]);
  const alts = doc.getIn(["alternatives"]);
  if (isSeq(alts)) alts.items.forEach((_, i) => withTakes(["alternatives", i]));
  return out;
}

/** What `spliceTime` did to one lane — for a caller reporting it, and for refusing a no-op. */
export interface TimeSplice {
  moved: number;
  removed: number;
}

/**
 * Insert or delete `lenBeats` of time at `atBeats`, across every placement list in the file.
 *
 * The rule for an event straddling the cut is the house one: **by its `start`**. An event whose
 * start is at or after the point moves; one already playing across it stays where it is and plays
 * over the inserted silence. That is what `moveTrackPlacementsInRange` and `selection consolidate`
 * both already do — they select by where a placement starts — and the alternative, cutting at the
 * point, would make inserting time a verb that writes new material and renders audio (see
 * docs/materialCut.md on why there is no free, reversible cut any more).
 *
 * Deleting removes the events that START inside the span and shifts the rest back, so
 * insert-then-delete of the same span returns the file to what it was, byte for byte. That round
 * trip is the property worth having and the one the test asserts.
 */
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
