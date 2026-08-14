// trackFile.ts — editing the PLACEMENTS on a lane, now that a lane is a node file
// (nodes/<name>.yaml, see docs/trackModules.md). The app's most frequent edit: every clip
// drag writes a placement's `start`. Reading and validating the file is moduleFile's job, since
// a lane is an ordinary module; what is here is the clip list and nothing else.

import { isSeq, parseDocument } from "yaml";
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

/**
 * WHERE this file's clips are — which is a CHOICE again.
 *
 * A lane's arrangement has variants once more (`alternatives:`, see ../docs/alternatives.md), and
 * each of them restates `clips:`. A list is a scalar to the merge, so the running set REPLACES the
 * arrangement rather than adding to it — which means an edit written to the top-level list while
 * another set is on does exactly what the older note here warned about: it "quietly rewrites an
 * arrangement nobody is looking at". A recorded take landed there and was silent on disk.
 *
 * So this is the seam that note kept open, now answering. Every edit below reads it from ITS
 * document, so recording, dragging, moving and removing all address the set that is playing.
 * Index 0 is the module's own fields, which ARE the first set and have no wrapper key.
 */
function clipsPath(doc: ReturnType<typeof parseDocument>): (string | number)[] {
  const at = currentAlternative(
    doc.toJS({ maxAliasCount: -1 }) as {
      alternatives?: unknown;
      alternative?: unknown;
    } | null,
  );
  return at === 0 ? ["clips"] : ["alternatives", at - 1, "clips"];
}

/** Set one field on the lane — what a colour picker writes. */
export function setTrackField(
  text: string,
  field: string,
  value: unknown,
): string {
  const doc = parseDocument(text, OPTS);
  if (value === null) doc.deleteIn([field]);
  else put(doc, [field], value);
  flowPlacements(doc);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** One placement per line — the shape the file already uses, kept on every write. */
function flowPlacements(doc: ReturnType<typeof parseDocument>): void {
  const clips = doc.getIn(clipsPath(doc));
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
  const CLIPS = clipsPath(doc);
  const clips = doc.getIn(CLIPS);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex(
    (_p, i) => String(doc.getIn([...CLIPS, i, "start"]) ?? "") === start,
  );
}

/** Move the placement at `start` to `to` — a clip drag, or `event move`. */
export function movePlacement(text: string, start: string, to: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  const CLIPS = clipsPath(doc);
  doc.setIn([...CLIPS, at, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(text: string, start: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  const CLIPS = clipsPath(doc);
  doc.deleteIn([...CLIPS, at]);
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
  const CLIPS = clipsPath(doc);
  const clips = doc.getIn(CLIPS);
  const node = doc.createNode(placement);
  node.flow = true; // one placement per line, as the file already writes them
  if (isSeq(clips)) clips.items.push(node);
  else doc.setIn(CLIPS, doc.createNode([node]));
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
  const CLIPS = clipsPath(doc);
  const clips = doc.getIn(CLIPS);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex((_p, i) => {
    const start = doc.getIn([...CLIPS, i, "start"]);
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
  const CLIPS = clipsPath(doc);
  const clips = doc.getIn(CLIPS);
  if (!isSeq(clips) || index < 0 || index >= clips.items.length) return null;
  return doc.getIn([...CLIPS, index], false) as Record<string, unknown> | null;
}

/**
 * Every placement in `text`, as PLAIN VALUES.
 *
 * Distinct from `placementAt`, which hands back the document node so a placement can be
 * carried into another file whole — read `ref` off that and you get a Scalar, not a string.
 */
export function placementValues(text: string): Record<string, unknown>[] {
  const doc = parseDocument(text, OPTS);
  const CLIPS = clipsPath(doc);
  const clips = doc.getIn(CLIPS);
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
  const CLIPS = clipsPath(doc);
  doc.deleteIn([...CLIPS, index]);
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
  const CLIPS = clipsPath(doc);
  if (value === undefined) doc.deleteIn([...CLIPS, index, field]);
  else doc.setIn([...CLIPS, index, field], value);
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
  const CLIPS = clipsPath(doc);
  doc.setIn([...CLIPS, index, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}
