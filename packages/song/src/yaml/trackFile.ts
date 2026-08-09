// trackFile.ts — reading and EDITING tracks/<id>.yaml (the app's most frequent edit:
// every fader drag writes `volume`, every clip drag writes a placement's `start`).
// THE TIMECODE RULE: every timecode is written QUOTED ("25:1", never 25:1) — unquoted
// is a valid YAML 1.1 sexagesimal number, so "25:1" would silently read back as 1501.

import { isSeq, LineCounter, parseDocument, Scalar, visit } from "yaml";
import { parsePosition } from "../timecode";
import { currentAlternative, pickAlternative } from "../trackAlternatives";
import type { ModuleIssue } from "./moduleFile";
import {
  TIMECODE,
  TIMECODE_KEYS,
  type Track,
  TrackSchema,
} from "./trackSchema";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

export interface ParsedTrack {
  value: Track | null;
  issues: ModuleIssue[];
}

export function parseTrack(text: string): ParsedTrack {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const result = TrackSchema.safeParse(doc.toJS() ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}

/** Quote every timecode in the document, wherever it sits — applied after every write rather than at each call site, so nothing can forget. */
export function quoteTimecodes(doc: ReturnType<typeof parseDocument>): void {
  visit(doc, {
    Pair(_, pair) {
      // A key set through the document API arrives as a bare string, not a Scalar — reading only `.value` there
      // skipped the pair entirely and let a freshly written `to: 3:1` out unquoted, which is the one bug this
      // function exists to prevent.
      const raw = pair.key as Scalar | string;
      const key = typeof raw === "string" ? raw : raw?.value;
      if (typeof key !== "string" || !TIMECODE_KEYS.has(key)) return;
      const quoted = (v: unknown): Scalar | undefined => {
        // A bare string has nowhere to carry the quoting style, so it is promoted to a Scalar that does.
        if (typeof v === "string" && TIMECODE.test(v)) {
          const s = new Scalar(v);
          s.type = Scalar.QUOTE_DOUBLE;
          return s;
        }
        const s = v as Scalar;
        if (s && typeof s.value === "string" && TIMECODE.test(s.value))
          s.type = Scalar.QUOTE_DOUBLE;
        return undefined;
      };
      const value = pair.value as { items?: unknown[] };
      // Scalars, but a sequence of them is marked item by item rather than skipped.
      if (Array.isArray(value?.items))
        value.items = value.items.map((i) => quoted(i) ?? i);
      else pair.value = quoted(value) ?? pair.value;
    },
  });
}

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
 * WHERE this file's clips are: `clips:`, or the alternative currently selected.
 *
 * Every edit below goes through this, and that is the whole of what alternatives cost the editing
 * layer — drag a clip while the second variant is showing and it is the second variant that is
 * written, not the first. Getting this wrong would not fail loudly: it would quietly edit an
 * arrangement nobody is looking at, and lose the one they are.
 *
 * Read off the DOCUMENT rather than a validated track, for the same reason `placementValues` is:
 * a file with one bad field elsewhere still has clips you can point at.
 */
function clipsPath(doc: ReturnType<typeof parseDocument>): (string | number)[] {
  const alts = doc.getIn(["alternatives"]);
  if (!isSeq(alts) || !alts.items.length) return ["clips"];
  const names = [
    "1",
    ...alts.items.map((_it, i) => {
      const name = doc.getIn(["alternatives", i, "name"]);
      return name === undefined || name === null ? String(i + 2) : String(name);
    }),
  ];
  const want = doc.getIn(["alternative"]);
  const at = pickAlternative(
    names,
    want === undefined || want === null ? undefined : String(want),
  );
  return at === 0 ? ["clips"] : ["alternatives", at - 1, "clips"];
}

/** Set one field on the track — what a fader or a mute button writes. */
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

/** The index of the placement starting at `start`, or -1. How the app addresses one. */
export function findPlacement(text: string, start: string): number {
  const { value } = parseTrack(text);
  if (!value || value.type !== "single") return -1;
  // The current alternative's placements, so an index means the same thing here as in the
  // document edits below — which is what makes `findPlacement` + `movePlacement` a valid pair.
  return currentAlternative(value).clips.findIndex((p) => p.start === start);
}

/** Move the placement at `start` to `to` — a clip drag, or `event move`. */
export function movePlacement(text: string, start: string, to: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.setIn([...clipsPath(doc), at, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(text: string, start: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn([...clipsPath(doc), at]);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Append a placement — the receiving half of a cross-track clip move. */
export function addPlacement(
  text: string,
  // No `length`: how long a placement sounds is the material's window times `loop` (see PlacementSchema).
  placement: { ref: string; start?: string; loop?: number },
): string {
  const doc = parseDocument(text, OPTS);
  const at = clipsPath(doc);
  const clips = doc.getIn(at);
  const node = doc.createNode(placement);
  node.flow = true; // one placement per line, as the file already writes them
  if (isSeq(clips)) clips.items.push(node);
  else doc.setIn(at, doc.createNode([node]));
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

// --- addressing a placement by POSITION (beats, not strings: "1:1:1", "1:1" and "1" are one position) ---

/** The index of the placement whose `start` parses to `beats`, or -1. Reads the DOCUMENT, not a validated track, so a schema problem elsewhere doesn't block a drag. */
export function findPlacementAt(
  text: string,
  beats: number,
  num: number,
  den: number,
): number {
  const doc = parseDocument(text, OPTS);
  const at = clipsPath(doc);
  const clips = doc.getIn(at);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex((_p, i) => {
    const start = doc.getIn([...at, i, "start"]);
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

/** The placement at `index`, as a plain object — for carrying one to another track. */
export function placementAt(
  text: string,
  index: number,
): Record<string, unknown> | null {
  const doc = parseDocument(text, OPTS);
  const at = clipsPath(doc);
  const clips = doc.getIn(at);
  if (!isSeq(clips) || index < 0 || index >= clips.items.length) return null;
  return doc.getIn([...at, index], false) as Record<string, unknown> | null;
}

/**
 * Every placement in `text`, as PLAIN VALUES.
 *
 * Distinct from `placementAt`, which hands back the document node so a placement can be
 * carried into another file whole — read `ref` off that and you get a Scalar, not a string.
 *
 * Read here rather than through `loadTracks` because an edit must not require a file the
 * SCHEMA accepts: a track missing its `type`, or carrying one bad field, still has placements
 * you can point at, and refusing to resize one because something else in the file is wrong
 * would be a worse failure than the one being reported.
 */
export function placementValues(text: string): Record<string, unknown>[] {
  const doc = parseDocument(text, OPTS);
  const clips = doc.getIn(clipsPath(doc));
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
  doc.deleteIn([...clipsPath(doc), index]);
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
  const at = clipsPath(doc);
  if (value === undefined) doc.deleteIn([...at, index, field]);
  else doc.setIn([...at, index, field], value);
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
  doc.setIn([...clipsPath(doc), index, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

// --- the ALTERNATIVES themselves (see ../trackAlternatives.ts) ------------------

/** Every variant's name, in order — `clips:` is the first and is always "1". */
export function alternativeNames(text: string): string[] {
  const doc = parseDocument(text, OPTS);
  const alts = doc.getIn(["alternatives"]);
  if (!isSeq(alts)) return ["1"];
  return [
    "1",
    ...alts.items.map((_it, i) => {
      const name = doc.getIn(["alternatives", i, "name"]);
      return name === undefined || name === null ? String(i + 2) : String(name);
    }),
  ];
}

/**
 * Switch which variant plays — ONE line rewritten, whatever the clip lists hold.
 *
 * That is the point of the format: the arrangements stay where they are, so a switch is a
 * one-line diff in git and a one-line entry in the undo journal, and nothing can be lost
 * half-way through moving a clip list from one key to another.
 *
 * Back to the first clears the key rather than writing `alternative: 1` — a track that plays its
 * own `clips:` is a track that says nothing about alternatives, which is how every song that
 * never uses them stays byte-identical.
 */
export function setAlternative(text: string, name: string): string {
  const names = alternativeNames(text);
  const at = pickAlternative(names, name);
  if (names[at] !== name) throw new Error(`no alternative "${name}"`);
  const doc = parseDocument(text, OPTS);
  if (at === 0) doc.deleteIn(["alternative"]);
  else doc.setIn(["alternative"], name);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/**
 * Add a variant and switch to it. Empty, or a copy of the one currently playing.
 *
 * Empty is the default because that is what a second take IS — the lane cleared, ready for
 * another pass. Copying is the other half of the same wish (keep this arrangement, try a change
 * to it), and doing it here rather than by hand means the copy carries every field of every
 * placement, which a re-typed one would not.
 */
export function addAlternative(
  text: string,
  name?: string,
  { copy = false }: { copy?: boolean } = {},
): { text: string; name: string } {
  const names = alternativeNames(text);
  const chosen = name ?? String(names.length + 1);
  if (names.includes(chosen))
    throw new Error(`this track already has an alternative "${chosen}"`);

  const doc = parseDocument(text, OPTS);
  // The clips BEFORE the new entry exists, or a copy would copy itself.
  const clips = copy ? (placementValues(text) as unknown[]) : ([] as unknown[]);
  const entry: Record<string, unknown> = {};
  // Named only when the author said one: an unnamed variant is known by its position, and
  // writing "3" into the file would freeze a name that is meant to follow the order.
  if (name !== undefined) entry.name = name;
  entry.clips = clips;
  const node = doc.createNode(entry);
  const alts = doc.getIn(["alternatives"]);
  if (isSeq(alts)) alts.items.push(node);
  else doc.setIn(["alternatives"], doc.createNode([node]));
  doc.setIn(["alternative"], chosen);
  flowPlacements(doc);
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), name: chosen };
}
