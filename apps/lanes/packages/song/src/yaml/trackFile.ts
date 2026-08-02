// trackFile.ts — reading and EDITING tracks/<id>.yaml (the app's most frequent edit:
// every fader drag writes `volume`, every clip drag writes a placement's `start`).
// THE TIMECODE RULE: every timecode is written QUOTED ("25:1", never 25:1) — unquoted
// is a valid YAML 1.1 sexagesimal number, so "25:1" would silently read back as 1501.

import { isSeq, LineCounter, parseDocument, Scalar, visit } from "yaml";
import { parsePosition } from "../timecode";
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
  const clips = doc.getIn(["clips"]);
  if (!isSeq(clips)) return;
  for (const p of clips.items)
    if (p && typeof p === "object") (p as { flow?: boolean }).flow = true;
}

/** The index of the placement starting at `start`, or -1. How the app addresses one. */
export function findPlacement(text: string, start: string): number {
  const { value } = parseTrack(text);
  if (!value || value.type !== "single") return -1;
  return (value.clips ?? []).findIndex((p) => p.start === start);
}

/** Move the placement at `start` to `to` — a clip drag, or `event move`. */
export function movePlacement(text: string, start: string, to: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.setIn(["clips", at, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** Drop the placement at `start`. The clip itself stays in the project. */
export function removePlacement(text: string, start: string): string {
  const at = findPlacement(text, start);
  if (at < 0) throw new Error(`no placement at ${start}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn(["clips", at]);
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
  const clips = doc.getIn(["clips"]);
  const node = doc.createNode(placement);
  node.flow = true; // one placement per line, as the file already writes them
  if (isSeq(clips)) clips.items.push(node);
  else doc.setIn(["clips"], doc.createNode([node]));
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
  const clips = doc.getIn(["clips"]);
  if (!isSeq(clips)) return -1;
  return clips.items.findIndex((_p, i) => {
    const start = doc.getIn(["clips", i, "start"]);
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
  const clips = doc.getIn(["clips"]);
  if (!isSeq(clips) || index < 0 || index >= clips.items.length) return null;
  return doc.getIn(["clips", index], false) as Record<string, unknown> | null;
}

/** Drop the placement at `index`. */
export function removePlacementAt(text: string, index: number): string {
  const doc = parseDocument(text, OPTS);
  doc.deleteIn(["clips", index]);
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
  if (value === undefined) doc.deleteIn(["clips", index, field]);
  else doc.setIn(["clips", index, field], value);
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
  doc.setIn(["clips", index, "start"], to);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}
