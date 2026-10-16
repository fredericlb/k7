// notes.ts — read/write the inline `notes:` list of a sequence file, the seam both note
// grids go through so an edit round-trips to the exact text the compiler reads back.
// Works on a SPAN rather than rewriting the document, which keeps the undo history and
// the cursor. See docs/noteGrids.md.

import { roundBeat } from "@studio/song-schema/timecode";
import { isSeq, parseDocument } from "yaml";

export interface Note {
  t: number; // onset, beats (fractional = microtiming)
  d: number; // duration, beats
  k: number; // MIDI key 0..127
  v?: number; // velocity 0..1 (omitted == default 1)
}

// A resolved rack: the symbol<->note maps the grids use, defined in this leaf module so neither side depends on the other.
export interface RackInfo {
  toSymbol: Map<number, string>; // MIDI note -> symbol (for display)
  toNote: Map<string, number>; // symbol -> MIDI note (for entry)
  order: { symbol: string; note: number }[]; // ascending by note — a stable palette
}

export interface NotesSpan {
  from: number;
  to: number;
  /** The indentation the list's items sit at, so a rewrite keeps the file's own shape. */
  indent: string;
}

/** Locate the `notes:` list: the span of its VALUE plus the indentation, or null when the file has none. */
export function findNotesArray(doc: string): NotesSpan | null {
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(doc, { version: "1.2" });
  } catch {
    return null;
  }
  if (parsed.errors.length) return null; // mid-keystroke: don't guess at a span
  const notes = parsed.get("notes", true);
  if (!isSeq(notes) || !notes.range) return null;
  const [from, rangeEnd] = notes.range;
  // Back off the node's trailing whitespace: replacing it would eat the newline and land the next key mid-list.
  let to = rangeEnd;
  while (to > from && /\s/.test(doc[to - 1])) to--;
  // The indent is whatever precedes the first item, read from the DOC — a hand-written file needn't use two spaces.
  const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  const lead = doc.slice(lineStart, from);
  return { from, to, indent: /^[ \t]*$/.test(lead) ? lead : "  " };
}

/** Parse a notes span's text. Anything that isn't a {t,d,k} mapping is skipped. */
export function parseNotes(arrayText: string): Note[] {
  let value: unknown;
  try {
    // Re-indented under a key so a bare block sequence parses, whatever indent the span's first line lost.
    value = (
      parseDocument(`notes:\n${reindent(arrayText)}`, {
        version: "1.2",
      }).toJS() as { notes?: unknown } | null
    )?.notes;
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Note[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const n = raw as Partial<Note>;
    if (!Number.isFinite(n.t) || !Number.isFinite(n.d) || !Number.isFinite(n.k))
      continue;
    const note: Note = { t: n.t as number, d: n.d as number, k: n.k as number };
    if (Number.isFinite(n.v)) note.v = n.v as number;
    out.push(note);
  }
  return out;
}

/** Put a span's lines at a known depth, so they parse under a key. */
function reindent(text: string): string {
  const [first, ...rest] = text.split("\n");
  const body = rest.filter((l) => l.trim());
  const drop = body.length
    ? Math.min(...body.map((l) => /^[ \t]*/.exec(l)![0].length))
    : 0;
  return [
    `  ${first.trimStart()}`,
    ...rest.map((l) => (l.trim() ? `  ${l.slice(drop)}` : l)),
  ].join("\n");
}

// Round to 6 decimals: onsets come from drags, and an exact float would churn the file on every no-op write.
const num = (v: number): string => String(roundBeat(v));

/** Serialize notes one per line at `indent`, the FIRST line bare since the text it replaces began after the indentation. */
export function renderNotes(notes: Note[], indent = "  "): string {
  if (!notes.length) return "[]";
  return notes
    .map((n, i) => {
      const v = n.v !== undefined ? `, v: ${num(n.v)}` : "";
      const row = `- { t: ${num(n.t)}, d: ${num(n.d)}, k: ${Math.round(n.k)}${v} }`;
      return i === 0 ? row : `${indent}${row}`;
    })
    .join("\n");
}
