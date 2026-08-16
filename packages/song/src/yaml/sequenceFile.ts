// sequenceFile.ts — editing sequences/<id>.yaml: `notes:` lists {t,d,k,v?} (t/d in beats, k a
// MIDI key, v a 0..1 velocity). Appends for `note add` and `sequence.recordNotes`, and addresses
// one note by (key, start) for the roll's velocity drag. One note per line (flow mapping) — the
// shape a recorded sequence shares with a hand-entered one.

import { isSeq, parseDocument } from "yaml";

export interface NoteIn {
  t: number;
  d: number;
  k: number;
  v?: number;
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

/**
 * The index of the note on key `k` starting at `t`, or -1.
 *
 * (key, start) is how a surface addresses a note, for the reason a placement is addressed by its
 * `start`: it is what the thing on screen knows about itself, and two notes cannot share the pair
 * without being the same note twice.
 *
 * Read off the DOCUMENT rather than a validated sequence, as trackFile's `findPlacement` is: a file
 * with one bad field elsewhere still has notes you can point at.
 */
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

/**
 * Move one note and/or change its length — what the roll's note drag writes.
 *
 * ONE writer for both, because on the roll they are one gesture with two grips: dragging the body
 * moves `t` and keeps `d`, dragging an edge keeps `t` and changes `d`. A `noteMove` and a
 * `noteResize` would be two verbs that must agree about how a note is addressed, and the second
 * one would eventually disagree.
 *
 * The note is found by its key and its CURRENT start, exactly as the velocity drag finds it — a
 * pitch and a place are what a roll can point at, and a note has no id of its own.
 *
 * `d` is a LENGTH, not an end: the file states it that way and the caller does the subtraction,
 * so nothing here has to know whether the end moved because the note grew or because it slid.
 */
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

/**
 * Remove one note — what the step sequencer's button-off writes.
 *
 * Addressed as every note edit addresses one, by key and start; throwing on a miss for the
 * same reason the others do — a surface that points at a note that is not there is out of
 * date, and silently removing nothing would hide that.
 */
export function removeNote(text: string, k: number, t: number): string {
  const at = findNote(text, k, t);
  if (at < 0) throw new Error(`no note k${k} at beat ${t}`);
  const doc = parseDocument(text, OPTS);
  doc.deleteIn(["notes", at]);
  return doc.toString({ lineWidth: 0 });
}

/**
 * Move one note to another key and/or start — what the sequencer's ctrl-drag writes.
 *
 * The note is MOVED, not rebuilt: only `k` and `t` are rewritten, so its length and its
 * velocity ride along untouched. Remove-then-add would have lost both — `sequence note new`
 * takes no velocity at all — and it would have been two journal steps for one act.
 *
 * The destination is refused when it already holds a note: (key, start) is how every surface
 * addresses one, so two notes sharing the pair would be the same note twice and the next edit
 * could not say which it meant.
 */
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

/**
 * Set one note's velocity — what the roll's velocity drag writes.
 *
 * `undefined` CLEARS the key rather than writing `v: 1`, so a note dragged back to full loses the
 * field it never had: the schema's default is 1, and a file that never mentions velocity stays
 * byte-identical. Same rule as `alternative:` going back to the first set.
 */
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
