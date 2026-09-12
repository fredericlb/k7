// sequenceFile.ts — editing sequences/<id>.yaml: `notes:` lists {t,d,k,v?} (t/d in beats, k a
// MIDI key, v a 0..1 velocity). Appends for `note add` and `sequence.recordNotes`, and addresses
// one note by (key, start) for the roll's velocity drag. `mapNotesInRegion` is the same edit over
// a RECTANGLE, in one pass, because a bulk edit has to be one undo. One note per line (flow
// mapping) — the shape a recorded sequence shares with a hand-entered one.

import { isSeq, parseDocument } from "yaml";
import { beatsToPosition, parsePosition } from "../timecode";

export interface NoteIn {
  t: number;
  d: number;
  k: number;
  v?: number;
  // A pad's effects, carried so a note that is COPIED brings them along — see docs/padEffects.md.
  repeat?: number;
  skip?: number;
}

const OPTS = { version: "1.2" as const, lineWidth: 0 };

/** Is `n` a note this can write — finite times, a positive length, a real MIDI key? */
export const isPlayableNote = (n: Partial<NoteIn>): n is NoteIn =>
  Number.isFinite(n.t) &&
  Number.isFinite(n.d) &&
  (n.d ?? 0) > 0 &&
  Number.isInteger(n.k) &&
  (n.k ?? -1) >= 0 &&
  (n.k ?? 128) <= 127;

/** Append `notes` to the sequence's list (creating it if absent), in the order given — the engine reads the list as a set, not in order. */
export function appendNotes(text: string, notes: NoteIn[]): string {
  const doc = parseDocument(text, OPTS);
  const nodes = notes.map((n) => {
    const node = doc.createNode({
      t: n.t,
      d: n.d,
      k: n.k,
      ...(n.v === undefined ? {} : { v: n.v }),
      // Only when there is one: a pad with no effect must not gain two keys saying so.
      ...(n.repeat ? { repeat: n.repeat } : {}),
      ...(n.skip ? { skip: n.skip } : {}),
    });
    node.flow = true;
    return node;
  });
  const list = doc.getIn(["notes"]);
  if (isSeq(list)) list.items.push(...nodes);
  else doc.setIn(["notes"], doc.createNode(nodes));
  return doc.toString({ lineWidth: 0 });
}

/** Two beat positions that are the same one. The times are decimals a surface computed. */
const EPS = 1e-6;

/** The index of the note on key `k` starting at `t`, or -1 — how every surface addresses one (docs/noteEdits.md). */
export function findNote(text: string, k: number, t: number): number {
  const doc = parseDocument(text, OPTS);
  const list = doc.getIn(["notes"]);
  if (!isSeq(list)) return -1;
  return list.items.findIndex(
    (_n, i) =>
      Number(doc.getIn(["notes", i, "k"]) ?? Number.NaN) === k &&
      Math.abs(Number(doc.getIn(["notes", i, "t"]) ?? Number.NaN) - t) < EPS,
  );
}

/** Move one note and/or change its length — ONE writer for the roll's two grips (docs/noteEdits.md). */
export function setNoteTimeRange(
  text: string,
  k: number,
  t: number,
  newT: number,
  newD: number,
): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  if (!(newD > 0)) throw new Error("a note has to be longer than nothing");
  if (newT < 0) throw new Error("a note cannot start before the sequence does");
  const doc = parseDocument(text, OPTS);
  doc.setIn(["notes", at, "t"], newT);
  doc.setIn(["notes", at, "d"], newD);
  return doc.toString({ lineWidth: 0 });
}

/** Remove one note, throwing on a miss like every note edit — see docs/noteEdits.md. */
export function removeNote(text: string, k: number, t: number): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn(["notes", at]);
  return doc.toString({ lineWidth: 0 });
}

/** Move one note to another key and/or start — MOVED and not rebuilt, see docs/noteEdits.md. */
export function moveNote(
  text: string,
  k: number,
  t: number,
  newK: number,
  newT: number,
): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  if (newT < 0) throw new Error("a note cannot start before the sequence does");
  const same = newK === k && Math.abs(newT - t) < EPS;
  if (!same && findNote(text, newK, newT) >= 0)
    throw new Error(`k${newK} already has a note at beat ${newT}`);
  const doc = parseDocument(text, OPTS);
  doc.setIn(["notes", at, "k"], newK);
  doc.setIn(["notes", at, "t"], newT);
  return doc.toString({ lineWidth: 0 });
}

/** Cut one note in two at beat `at`, which must be strictly INSIDE it — see docs/noteEdits.md. */
export function splitNote(
  text: string,
  k: number,
  t: number,
  at: number,
): string {
  const i = findNote(text, k, t);
  if (i < 0) throw new Error(`no note k${k} at beat ${t}`);
  const doc = parseDocument(text, OPTS);
  const d = Number(doc.getIn(["notes", i, "d"]) ?? Number.NaN);
  if (!Number.isFinite(d) || d <= 0)
    throw new Error(`the note k${k} at beat ${t} has no length to split`);
  if (at <= t + EPS || at >= t + d - EPS)
    throw new Error(
      `${at} is not inside the note — it runs ${t} to ${t + d}, and a split has to leave two`,
    );
  const v = doc.getIn(["notes", i, "v"]);
  doc.setIn(["notes", i, "d"], at - t);
  return appendNotes(doc.toString({ lineWidth: 0 }), [
    { t: at, d: t + d - at, k, ...(typeof v === "number" ? { v } : {}) },
  ]);
}

/** Set one note's velocity; `undefined` CLEARS the key rather than writing `v: 1` (docs/noteEdits.md). */
export function setNoteVelocity(
  text: string,
  k: number,
  t: number,
  v: number | undefined,
): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  const doc = parseDocument(text, OPTS);
  if (v === undefined) doc.deleteIn(["notes", at, "v"]);
  else doc.setIn(["notes", at, "v"], v);
  return doc.toString({ lineWidth: 0 });
}

/** A rectangle of the roll, as a surface draws one: two keys INCLUSIVE, and a half-open beat span. */
export interface NoteRegion {
  loKey: number;
  hiKey: number;
  from: number;
  to: number;
}

/** One note read back out of the document, or null for a line that is not one — a broken entry is left alone, not rewritten. */
function readNote(
  doc: ReturnType<typeof parseDocument>,
  i: number,
): NoteIn | null {
  const t = Number(doc.getIn(["notes", i, "t"]) ?? Number.NaN);
  const d = Number(doc.getIn(["notes", i, "d"]) ?? Number.NaN);
  const k = Number(doc.getIn(["notes", i, "k"]) ?? Number.NaN);
  const v = doc.getIn(["notes", i, "v"]);
  const repeat = doc.getIn(["notes", i, "repeat"]);
  const skip = doc.getIn(["notes", i, "skip"]);
  if (!Number.isFinite(t) || !Number.isFinite(d) || !Number.isFinite(k))
    return null;
  return {
    t,
    d,
    k,
    ...(typeof v === "number" ? { v } : {}),
    // Carried so a note that is COPIED keeps its pad effects — @studio/song docs/padEffects.md.
    ...(typeof repeat === "number" ? { repeat } : {}),
    ...(typeof skip === "number" ? { skip } : {}),
  };
}

/**
 * Rewrite every note the region HOLDS, in one document pass; `fn` answering null removes one.
 * A note is in when it STARTS inside, the rule the roll's rectangle already copies by. One pass
 * and not N calls to the writers above, because a bulk edit has to be ONE journal entry — see
 * docs/noteEdits.md. `repeat` and `skip` are never touched, so a pad keeps its effects.
 */
export function mapNotesInRegion(
  text: string,
  region: NoteRegion,
  fn: (n: NoteIn) => NoteIn | null,
): { text: string; changed: number } {
  const doc = parseDocument(text, OPTS);
  const list = doc.getIn(["notes"]);
  if (!isSeq(list)) return { text, changed: 0 };
  const drop: number[] = [];
  let changed = 0;
  for (let i = 0; i < list.items.length; i++) {
    const n = readNote(doc, i);
    if (
      !n ||
      n.k < region.loKey ||
      n.k > region.hiKey ||
      n.t < region.from - EPS ||
      n.t >= region.to - EPS
    )
      continue;
    const next = fn(n);
    if (next === null) {
      drop.push(i);
      changed++;
      continue;
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
    changed++;
  }
  // Back to front, so an index taken before the first deletion still points at its own note.
  for (const i of drop.reverse()) doc.deleteIn(["notes", i]);
  return changed
    ? { text: doc.toString({ lineWidth: 0 }), changed }
    : { text, changed: 0 };
}

/** A sequence's WINDOW in beats, as the compiler reads it — the rule is one, so it is stated once. */
function windowOf(
  doc: ReturnType<typeof parseDocument>,
  notes: NoteIn[],
  num: number,
  den: number,
): { from: number; to: number } {
  const bar = (num * 4) / den;
  // The notes' extent rounded UP TO THE BAR, which is what a sequence stating no `to` is long — packages/song/docs/graphModel.md.
  const extent =
    Math.ceil(notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) / bar) * bar;
  const raw = (key: string): number | null => {
    const v = doc.get(key);
    return v == null ? null : parsePosition(String(v), num, den);
  };
  const from = raw("from") ?? 0;
  const stated = raw("to");
  // A `to` at or before `from` falls back to the extent, the fallback nodeProject.ts applies.
  const to = stated !== null && stated > from ? stated : Math.max(extent, from);
  return { from, to };
}

/** Twice as long, playing twice: the window's notes copied one window later, a stated `to` moved out — docs/noteEdits.md. */
export function doubleSequence(text: string, num: number, den: number): string {
  const doc = parseDocument(text, OPTS);
  const list = doc.getIn(["notes"]);
  const notes: NoteIn[] = [];
  if (isSeq(list))
    for (let i = 0; i < list.items.length; i++) {
      const n = readNote(doc, i);
      if (n) notes.push(n);
    }
  if (!notes.length)
    throw new Error("no notes to double — this sequence is empty");
  const { from, to } = windowOf(doc, notes, num, den);
  const win = to - from;
  if (!(win > 0)) throw new Error("this sequence has no length to double");
  // What the window holds, by the rule every bulk edit here follows: a note is in when it STARTS inside.
  const copies = notes
    .filter((n) => n.t >= from - EPS && n.t < to - EPS)
    .map((n) => ({ ...n, t: n.t + win }));
  if (!copies.length)
    throw new Error("no notes inside the window — nothing to double");
  if (doc.get("to") != null)
    doc.set("to", beatsToPosition(from + 2 * win, num, den));
  return appendNotes(doc.toString({ lineWidth: 0 }), copies);
}

/** The two effects a PAD can carry — see @studio/song docs/padEffects.md. */
export type PadEffect = "repeat" | "skip";

/** Turn one of a pad's effects on, or off with `undefined`, which DELETES the key (docs/noteEdits.md). */
export function setNoteEffect(
  text: string,
  k: number,
  t: number,
  effect: PadEffect,
  n: number | undefined,
): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  if (n !== undefined && (!Number.isInteger(n) || n < 2))
    throw new Error(
      `${effect} takes a whole number of 2 or more — ${n} says nothing a pad without it does not`,
    );
  const doc = parseDocument(text, OPTS);
  if (n === undefined) doc.deleteIn(["notes", at, effect]);
  else doc.setIn(["notes", at, effect], n);
  return doc.toString({ lineWidth: 0 });
}
