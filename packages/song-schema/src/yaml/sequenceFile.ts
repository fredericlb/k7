// sequenceFile.ts — editing sequences/<id>.k7x: `notes` lists {t,d,k,v?} (t/d in beats, k a MIDI key, v a 0..1 velocity).
// Every writer edits a K7Scope at the file's root and addresses one note by (key, start); `mapNotesInRegion` is the same
// edit over a RECTANGLE, in one pass, because a bulk edit has to be one undo. A note is appended on a line of its own.
// A reader would get wrong what a writer sees: EXPANDED notes. A file may write them `notes("c4 d4")`, so an edit runs
// through wsEdit or `editSequence`, which put the short form back by sugar's rule (docs/sugar.md); readers expand it.

import { K7Document, type K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { beatsToPosition, parsePosition } from "../timecode";
import { applySugared, type Sugar, sugarFor } from "./sugar";

export interface NoteIn {
  t: number;
  d: number;
  k: number;
  v?: number;
  // A pad's effects, carried so a note that is COPIED brings them along — see docs/padEffects.md.
  repeat?: number;
  skip?: number;
}

type Data = Record<string, unknown>;

/** The short form a sequence file may write, the one sugar.ts states for every file under sequences/. */
const SEQUENCE_SUGAR = sugarFor("sequences/sequence.k7x") as Sugar;

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Is `n` a note this can write — finite times, a positive length, a real MIDI key? */
export const isPlayableNote = (n: Partial<NoteIn>): n is NoteIn =>
  Number.isFinite(n.t) &&
  Number.isFinite(n.d) &&
  (n.d ?? 0) > 0 &&
  Number.isInteger(n.k) &&
  (n.k ?? -1) >= 0 &&
  (n.k ?? 128) <= 127;

/** A sequence's data with its short form expanded — what every reader here reads; throws when the short form does not read. */
export function sequenceData(doc: K7Scope): Data {
  const raw = doc.toJS();
  return SEQUENCE_SUGAR.expand(isRecord(raw) ? raw : {});
}

/** Runs `edit` over a sequence's k7x text as wsEdit does over its file: on expanded notes, the short form kept while it holds. */
export function editSequence<R>(
  text: string,
  edit: (doc: K7Scope) => R,
): { text: string; result: R } {
  const doc = new K7Document(text);
  const raw = doc.toJS();
  if (!SEQUENCE_SUGAR.parts.some((p) => p.present(raw)))
    return { result: edit(doc.at([])), text: doc.toString() };
  const scratch = new K7Document(
    stringify(SEQUENCE_SUGAR.expand(raw), { header: doc.header }),
  );
  const result = edit(scratch.at([]));
  applySugared(doc, scratch.toJS(), SEQUENCE_SUGAR);
  return { result, text: doc.toString() };
}

/** The notes a WRITER addresses: the list as written, refused when it is still in the short form. */
function writableNotes(doc: K7Scope): unknown[] {
  const raw = doc.toJS();
  if (isRecord(raw) && SEQUENCE_SUGAR.parts.some((p) => p.present(raw)))
    throw new Error(
      "sequence: its notes are in the short form — edit it through editSequence or wsEdit",
    );
  const notes = doc.getIn(["notes"]);
  return Array.isArray(notes) ? notes : [];
}

/** A note as written, its fields only when they are there — a pad with no effect must not gain two keys saying so. */
const noteValue = (n: NoteIn): Data => ({
  t: n.t,
  d: n.d,
  k: n.k,
  ...(n.v === undefined ? {} : { v: n.v }),
  ...(n.repeat ? { repeat: n.repeat } : {}),
  ...(n.skip ? { skip: n.skip } : {}),
});

/** Append `notes` to the sequence's list (creating it if absent), in the order given — the engine reads the list as a set. */
export function appendNotes(doc: K7Scope, notes: NoteIn[]): void {
  const values = notes.map(noteValue);
  writableNotes(doc);
  if (!values.length) return;
  if (!Array.isArray(doc.getIn(["notes"]))) {
    doc.setIn(["notes"], values);
    return;
  }
  for (const v of values) doc.addIn(["notes"], v, { inline: true });
}

/** Two beat positions that are the same one. The times are decimals a surface computed. */
const EPS = 1e-6;

const indexIn = (notes: unknown[], k: number, t: number): number =>
  notes.findIndex(
    (n) =>
      isRecord(n) &&
      Number(n.k ?? Number.NaN) === k &&
      Math.abs(Number(n.t ?? Number.NaN) - t) < EPS,
  );

/** The index of the note on key `k` starting at `t`, or -1 — how every surface addresses one (docs/noteEdits.md). */
export function findNote(doc: K7Scope, k: number, t: number): number {
  const notes = sequenceData(doc).notes;
  return Array.isArray(notes) ? indexIn(notes, k, t) : -1;
}

/** The index a writer edits, throwing on a miss like every note edit. */
function noteAt(doc: K7Scope, k: number, t: number): number {
  const at = indexIn(writableNotes(doc), k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  return at;
}

/** Move one note and/or change its length — ONE writer for the roll's two grips (docs/noteEdits.md). */
export function setNoteTimeRange(
  doc: K7Scope,
  k: number,
  t: number,
  newT: number,
  newD: number,
): void {
  const at = noteAt(doc, k, t);
  if (!(newD > 0)) throw new Error("a note has to be longer than nothing");
  if (newT < 0) throw new Error("a note cannot start before the sequence does");
  doc.setIn(["notes", at, "t"], newT);
  doc.setIn(["notes", at, "d"], newD);
}

/** Remove one note, throwing on a miss like every note edit — see docs/noteEdits.md. */
export function removeNote(doc: K7Scope, k: number, t: number): void {
  doc.deleteIn(["notes", noteAt(doc, k, t)]);
}

/** Move one note to another key and/or start — MOVED and not rebuilt, see docs/noteEdits.md. */
export function moveNote(
  doc: K7Scope,
  k: number,
  t: number,
  newK: number,
  newT: number,
): void {
  const at = noteAt(doc, k, t);
  if (newT < 0) throw new Error("a note cannot start before the sequence does");
  const same = newK === k && Math.abs(newT - t) < EPS;
  if (!same && indexIn(writableNotes(doc), newK, newT) >= 0)
    throw new Error(`k${newK} already has a note at beat ${newT}`);
  doc.setIn(["notes", at, "k"], newK);
  doc.setIn(["notes", at, "t"], newT);
}

/** One note's way to somewhere else: from key `k` at `t` to key `nk` at `nt`. */
export interface NoteMove {
  k: number;
  t: number;
  nk: number;
  nt: number;
}

/** Move SEVERAL notes in one pass, each to its own destination; a target is free unless a note that STAYS holds it (docs/noteEdits.md). */
export function moveNotes(doc: K7Scope, moves: readonly NoteMove[]): void {
  if (!moves.length) throw new Error("no note to move");
  const notes = writableNotes(doc);
  if (!notes.length) throw new Error("the sequence has no notes");
  // Every index read BEFORE any write: a moved note must not be found again at its new place.
  const from = moves.map((m) => {
    const i = indexIn(notes, m.k, m.t);
    if (i < 0) throw new Error(`no note k${m.k} at beat ${m.t}`);
    return i;
  });
  if (new Set(from).size !== from.length)
    throw new Error("the same note is moved twice");
  const leaving = new Set(from);
  const landing = new Set<string>();
  for (const m of moves) {
    if (!Number.isInteger(m.nk) || m.nk < 0 || m.nk > 127)
      throw new Error(`k${m.nk} is not a MIDI key`);
    if (!Number.isFinite(m.nt) || m.nt < 0)
      throw new Error("a note cannot start before the sequence does");
    const there = indexIn(notes, m.nk, m.nt);
    if (there >= 0 && !leaving.has(there))
      throw new Error(`k${m.nk} already has a note at beat ${m.nt}`);
    const spot = `${m.nk}@${Math.round(m.nt / EPS)}`;
    if (landing.has(spot))
      throw new Error(`two notes would land on k${m.nk} at beat ${m.nt}`);
    landing.add(spot);
  }
  moves.forEach((m, j) => {
    doc.setIn(["notes", from[j], "k"], m.nk);
    doc.setIn(["notes", from[j], "t"], m.nt);
  });
}

/** Cut one note in two at beat `at`, which must be strictly INSIDE it — see docs/noteEdits.md. */
export function splitNote(
  doc: K7Scope,
  k: number,
  t: number,
  at: number,
): void {
  const i = noteAt(doc, k, t);
  const d = Number(doc.getIn(["notes", i, "d"]) ?? Number.NaN);
  if (!Number.isFinite(d) || d <= 0)
    throw new Error(`the note k${k} at beat ${t} has no length to split`);
  if (at <= t + EPS || at >= t + d - EPS)
    throw new Error(
      `${at} is not inside the note — it runs ${t} to ${t + d}, and a split has to leave two`,
    );
  const v = doc.getIn(["notes", i, "v"]);
  doc.setIn(["notes", i, "d"], at - t);
  appendNotes(doc, [
    { t: at, d: t + d - at, k, ...(typeof v === "number" ? { v } : {}) },
  ]);
}

/** Set one note's velocity; `undefined` CLEARS the key rather than writing `v: 1` (docs/noteEdits.md). */
export function setNoteVelocity(
  doc: K7Scope,
  k: number,
  t: number,
  v: number | undefined,
): void {
  const at = noteAt(doc, k, t);
  if (v === undefined) doc.deleteIn(["notes", at, "v"]);
  else doc.setIn(["notes", at, "v"], v);
}

/** A rectangle of the roll, as a surface draws one: two keys INCLUSIVE, and a half-open beat span. */
export interface NoteRegion {
  loKey: number;
  hiKey: number;
  from: number;
  to: number;
}

/** One note as plain values, or null for an entry that is not one — a broken entry is left alone, not rewritten. */
function readNote(raw: unknown): NoteIn | null {
  if (!isRecord(raw)) return null;
  const t = Number(raw.t ?? Number.NaN);
  const d = Number(raw.d ?? Number.NaN);
  const k = Number(raw.k ?? Number.NaN);
  if (!Number.isFinite(t) || !Number.isFinite(d) || !Number.isFinite(k))
    return null;
  return {
    t,
    d,
    k,
    ...(typeof raw.v === "number" ? { v: raw.v } : {}),
    // Carried so a note that is COPIED keeps its pad effects — @studio/song docs/padEffects.md.
    ...(typeof raw.repeat === "number" ? { repeat: raw.repeat } : {}),
    ...(typeof raw.skip === "number" ? { skip: raw.skip } : {}),
  };
}

/** Rewrite every note the region HOLDS (it STARTS inside) in one pass, `fn` answering null removing one; answers how many changed. */
export function mapNotesInRegion(
  doc: K7Scope,
  region: NoteRegion,
  fn: (n: NoteIn) => NoteIn | null,
): number {
  const notes = writableNotes(doc);
  const drop: number[] = [];
  let changed = 0;
  notes.forEach((raw, i) => {
    const n = readNote(raw);
    if (
      !n ||
      n.k < region.loKey ||
      n.k > region.hiKey ||
      n.t < region.from - EPS ||
      n.t >= region.to - EPS
    )
      return;
    const next = fn(n);
    changed++;
    if (next === null) {
      drop.push(i);
      return;
    }
    if (!isPlayableNote(next))
      throw new Error(
        `k${n.k} at beat ${n.t} would become a note nothing can play`,
      );
    if (next.k !== n.k) doc.setIn(["notes", i, "k"], next.k);
    if (next.t !== n.t) doc.setIn(["notes", i, "t"], next.t);
    if (next.d !== n.d) doc.setIn(["notes", i, "d"], next.d);
    // Velocity keeps the file's own rule: `undefined` CLEARS the key rather than writing the schema's default back.
    if (next.v !== n.v) {
      if (next.v === undefined) doc.deleteIn(["notes", i, "v"]);
      else doc.setIn(["notes", i, "v"], next.v);
    }
  });
  // Back to front, so an index taken before the first deletion still points at its own note.
  for (const i of drop.reverse()) doc.deleteIn(["notes", i]);
  return changed;
}

/** A sequence's WINDOW in beats, as the compiler reads it — the rule is one, so it is stated once. */
function windowOf(
  data: Data,
  notes: NoteIn[],
  num: number,
  den: number,
): { from: number; to: number } {
  const bar = (num * 4) / den;
  // The notes' extent rounded UP TO THE BAR, which is what a sequence stating no `to` is long — packages/song/docs/graphModel.md.
  const extent =
    Math.ceil(notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) / bar) * bar;
  const raw = (key: string): number | null => {
    const v = data[key];
    return v == null ? null : parsePosition(String(v), num, den);
  };
  const from = raw("from") ?? 0;
  const stated = raw("to");
  // A `to` at or before `from` falls back to the extent, the fallback nodeProject.ts applies.
  const to = stated !== null && stated > from ? stated : Math.max(extent, from);
  return { from, to };
}

/** Twice as long, playing twice: the window's notes copied one window later, a stated `to` moved out — docs/noteEdits.md. */
export function doubleSequence(doc: K7Scope, num: number, den: number): void {
  const notes = writableNotes(doc)
    .map(readNote)
    .filter((n): n is NoteIn => n !== null);
  if (!notes.length)
    throw new Error("no notes to double — this sequence is empty");
  const data = doc.toJS() as Data;
  const { from, to } = windowOf(data, notes, num, den);
  const win = to - from;
  if (!(win > 0)) throw new Error("this sequence has no length to double");
  // What the window holds, by the rule every bulk edit here follows: a note is in when it STARTS inside.
  const copies = notes
    .filter((n) => n.t >= from - EPS && n.t < to - EPS)
    .map((n) => ({ ...n, t: n.t + win }));
  if (!copies.length)
    throw new Error("no notes inside the window — nothing to double");
  if (data.to != null)
    doc.setIn(["to"], beatsToPosition(from + 2 * win, num, den));
  appendNotes(doc, copies);
}

/** The two effects a PAD can carry — see @studio/song docs/padEffects.md. */
export type PadEffect = "repeat" | "skip";

/** Turn one of a pad's effects on, or off with `undefined`, which DELETES the key (docs/noteEdits.md). */
export function setNoteEffect(
  doc: K7Scope,
  k: number,
  t: number,
  effect: PadEffect,
  n: number | undefined,
): void {
  const at = noteAt(doc, k, t);
  if (n !== undefined && (!Number.isInteger(n) || n < 2))
    throw new Error(
      `${effect} takes a whole number of 2 or more — ${n} says nothing a pad without it does not`,
    );
  if (n === undefined) doc.deleteIn(["notes", at, effect]);
  else doc.setIn(["notes", at, effect], n);
}
