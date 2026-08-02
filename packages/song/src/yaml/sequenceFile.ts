// sequenceFile.ts — appending notes to sequences/<id>.yaml: `notes:` lists {t,d,k,v?}
// (t/d in beats, k a MIDI key). Written by `note add` and `sequence.recordNotes`, one
// note per line (flow mapping) — the shape a recorded sequence shares with a hand-entered one.

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
