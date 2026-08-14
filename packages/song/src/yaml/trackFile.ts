// trackFile.ts — editing the PLACEMENTS on a lane, now that a lane is a node file
// (nodes/<name>.yaml, see docs/trackModules.md). The app's most frequent edit: every clip
// drag writes a placement's `start`. Reading and validating the file is moduleFile's job, since
// a lane is an ordinary module; what is here is the clip list — and WHICH list, since a lane on
// one of its alternatives has two (docs/alternatives.md).

import { isMap, isSeq, parseDocument } from "yaml";
import { currentAlternative } from "../alternatives";
import { parsePosition } from "../timecode";
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

/** The module's own arrangement — attribute set "1", and where a lane with no sets keeps its clips. */
const OWN_CLIPS: (string | number)[] = ["clips"];

/**
 * WHERE this file's clips are, and it is a CHOICE again.
 *
 * A lane is a module node, so its takes are that module's attribute sets: `clips:` can exist at
 * the top of the file (set "1") and once more inside each entry under `alternatives:`. Which one
 * an edit means is whichever set is ON — and reading and writing do not always agree, which is
 * why there are two of these:
 *
 * - `clipsIn` is what an edit ADDRESSES. A set that states no `clips:` of its own inherits the
 *   module's, so that is what is on screen and what a clip is picked out of.
 * - `clipsToEdit` is where the edit LANDS: always the selected set, forking the inherited list
 *   into it on the first write.
 *
 * That fork is the whole fix. Every edit here used to write `["clips"]` flat, so dragging a clip
 * while on take 2 rewrote take 1 — the arrangement you were not looking at — and the two takes
 * were never separate documents at all. See ../docs/alternatives.md.
 */
function selectedSet(doc: ReturnType<typeof parseDocument>): number {
  return currentAlternative((doc.toJS() ?? {}) as Record<string, unknown>);
}

function setClips(at: number): (string | number)[] {
  return ["alternatives", at - 1, "clips"];
}

function clipsIn(doc: ReturnType<typeof parseDocument>): (string | number)[] {
  const at = selectedSet(doc);
  if (at === 0) return OWN_CLIPS;
  const mine = setClips(at);
  return isSeq(doc.getIn(mine)) ? mine : OWN_CLIPS;
}

function clipsToEdit(
  doc: ReturnType<typeof parseDocument>,
): (string | number)[] {
  const at = selectedSet(doc);
  if (at === 0) return OWN_CLIPS;
  const mine = setClips(at);
  if (isSeq(doc.getIn(mine))) return mine;
  // First edit on a set that was inheriting: fork what it was PLAYING into it, so the edit
  // changes what you see and set 1 keeps what it had. `clone()` rather than a rebuild from plain
  // values, because it is a deep copy that brings each placement's own comments with it.
  const inherited = doc.getIn(OWN_CLIPS);
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
  flowPlacements(doc, clipsIn(doc));
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** One placement per line — the shape the file already uses, kept on every write. */
function flowPlacements(
  doc: ReturnType<typeof parseDocument>,
  path: (string | number)[],
): void {
  const clips = doc.getIn(path);
  if (!isSeq(clips)) return;
  for (const p of clips.items)
    if (p && typeof p === "object") (p as { flow?: boolean }).flow = true;
}

/**
 * The index of the placement starting at `start`, or -1. How the app addresses one.
 *
 * Reads the DOCUMENT rather than a validated lane, for the same reason `placementValues` does: a
 * file with one bad field elsewhere still has clips you can point at, and refusing a drag because
 * something unrelated is wrong would be a worse failure than the one being reported.
 */
export function findPlacement(text: string, start: string): number {
  const doc = parseDocument(text, OPTS);
  const path = clipsIn(doc);
  const clips = doc.getIn(path);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex(
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
  doc.setIn([...clipsToEdit(doc), at, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(text: string, start: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn([...clipsToEdit(doc), at]);
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
  const path = clipsToEdit(doc);
  const clips = doc.getIn(path);
  const node = doc.createNode(placement);
  node.flow = true; // one placement per line, as the file already writes them
  if (isSeq(clips)) clips.items.push(node);
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
  const path = clipsIn(doc);
  const clips = doc.getIn(path);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex((_p, i) => {
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

/** The placement at `index`, as a plain object — for carrying one to another lane. */
export function placementAt(
  text: string,
  index: number,
): Record<string, unknown> | null {
  const doc = parseDocument(text, OPTS);
  const path = clipsIn(doc);
  const clips = doc.getIn(path);
  if (!isSeq(clips) || index < 0 || index >= clips.items.length) return null;
  return doc.getIn([...path, index], false) as Record<string, unknown> | null;
}

/**
 * Every placement in `text`, as PLAIN VALUES.
 *
 * Distinct from `placementAt`, which hands back the document node so a placement can be
 * carried into another file whole — read `ref` off that and you get a Scalar, not a string.
 */
export function placementValues(text: string): Record<string, unknown>[] {
  const doc = parseDocument(text, OPTS);
  const clips = doc.getIn(clipsIn(doc));
  if (!isSeq(clips)) return [];
  return clips.items.map(
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
  doc.deleteIn([...clipsToEdit(doc), index]);
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
  const path = clipsToEdit(doc);
  if (value === undefined) doc.deleteIn([...path, index, field]);
  else doc.setIn([...path, index, field], value);
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
  doc.setIn([...clipsToEdit(doc), index, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}
