// notes.ts — read and write a sequence file's `notes` list, the seam both note grids go through, so an edit
// round-trips to the exact k7x the compiler reads back. A write changes only the notes that changed, a pad keeps
// its effects, and a `notes("c4 d4")` short form stays while it still says the same thing. See docs/noteGrids.md.

import { K7Document } from "@studio/k7x/document";
import { roundBeat } from "@studio/song-schema/timecode";
import {
  editSequence,
  sequenceData,
} from "@studio/song-schema/yaml/sequenceFile";

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

/** What the grids read off a sequence: its notes, expanded, and the rack it names. */
export interface SequenceRead {
  notes: Note[];
  useRack: string | null;
}

type Data = Record<string, unknown>;

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The notes of a list as read: anything that is not a {t,d,k} map is skipped. */
function notesOf(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const out: Note[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { t, d, k, v } = raw;
    if (typeof t !== "number" || typeof d !== "number" || typeof k !== "number")
      continue;
    if (!Number.isFinite(t) || !Number.isFinite(d) || !Number.isFinite(k))
      continue;
    const note: Note = { t, d, k };
    if (typeof v === "number" && Number.isFinite(v)) note.v = v;
    out.push(note);
  }
  return out;
}

/** A sequence's notes and rack, or null while the text does not read or has no notes list. */
export function readSequence(text: string): SequenceRead | null {
  let data: Data;
  try {
    data = sequenceData(new K7Document(text).at([]));
  } catch {
    return null;
  }
  if (!Array.isArray(data.notes)) return null;
  const rack = data.use_rack;
  return {
    notes: notesOf(data.notes),
    useRack: typeof rack === "string" && rack.trim() ? rack.trim() : null,
  };
}

// Round to 6 decimals: onsets come from drags, and an exact float would churn the file on every no-op write.
const noteKey = (k: number, t: number) => `${Math.round(k)}@${roundBeat(t)}`;

/** The whole list written back, each note's pad effects carried from the note it was; null when the text does not read. */
export function writeNotes(
  text: string,
  notes: readonly Note[],
): string | null {
  try {
    return editSequence(text, (doc) => {
      const was = sequenceData(doc).notes;
      const effects = new Map<string, Data>();
      for (const n of Array.isArray(was) ? was : [])
        if (isRecord(n) && (n.repeat !== undefined || n.skip !== undefined))
          effects.set(noteKey(Number(n.k), Number(n.t)), {
            ...(n.repeat === undefined ? {} : { repeat: n.repeat }),
            ...(n.skip === undefined ? {} : { skip: n.skip }),
          });
      const next = notes.map((n) => ({
        t: roundBeat(n.t),
        d: roundBeat(n.d),
        k: Math.round(n.k),
        ...(n.v === undefined ? {} : { v: roundBeat(n.v) }),
        ...effects.get(noteKey(n.k, n.t)),
      }));
      doc.applyIn(["notes"], next);
    }).text;
  } catch {
    return null;
  }
}
