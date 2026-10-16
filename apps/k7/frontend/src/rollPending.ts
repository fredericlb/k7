// rollPending.ts — the piano roll's optimistic paint. A `sequence note` command costs ~400 ms on
// the service (it recompiles the project), so the gesture paints at once and the ghost is held
// until the DOCUMENT agrees. The step sequencer learnt this first; its ghosts are indexed by CELL
// and by precision, which is not the roll's shape — here the key is the ADDRESS every note verb
// takes, `${key}@${start}`. See docs/clipEditors.md.

import { roundBeat } from "@studio/song-schema/timecode";

export interface RollNote {
  key: number;
  time: number;
  duration: number;
  vel?: number;
}

/** Two beats that are the same one — the writers' own EPS, since these ghosts are compared against what they wrote. */
const EPS = 1e-6;

/** How a note is addressed, here and in every `sequence note …` verb: its key and where it starts. */
export const noteAddr = (key: number, time: number): string =>
  `${key}@${roundBeat(time)}`;

/**
 * One edit in flight, keyed by the address it was made AT. `null` removes; anything else is what
 * the note becomes — a move keeps its old address as the key, which is what lets the ghost say
 * "gone from here, there instead" in one entry.
 */
export type RollGhosts = ReadonlyMap<string, RollNote | null>;

/** What the roll DRAWS: the document with the ghosts laid over it. */
export function paintNotes(
  doc: readonly RollNote[],
  pending: RollGhosts,
): RollNote[] {
  if (!pending.size) return doc as RollNote[];
  const out = doc.filter((n) => !pending.has(noteAddr(n.key, n.time)));
  for (const to of pending.values()) if (to) out.push(to);
  return out;
}

/** Does the document hold this note, down to what the edit set? A move that has not landed reads as absent. */
const holds = (doc: readonly RollNote[], to: RollNote): boolean =>
  doc.some(
    (n) =>
      n.key === to.key &&
      Math.abs(n.time - to.time) < EPS &&
      Math.abs(n.duration - to.duration) < EPS &&
      Math.abs((n.vel ?? 1) - (to.vel ?? 1)) < EPS,
  );

/**
 * Which ghosts the document has caught up with. One it CONTRADICTS is kept, being still in
 * flight; the caller drops the rest wholesale once nothing is in flight, since a ghost that still
 * disagrees then was a command that FAILED.
 */
export function settledNotes(
  doc: readonly RollNote[],
  pending: RollGhosts,
): string[] {
  const out: string[] = [];
  const at = new Set(doc.map((n) => noteAddr(n.key, n.time)));
  for (const [addr, to] of pending) {
    if (to === null) {
      if (!at.has(addr)) out.push(addr);
      continue;
    }
    // A move settles only when BOTH halves have landed: arrived there, and gone from where it was.
    const moved = noteAddr(to.key, to.time) !== addr;
    if (holds(doc, to) && (!moved || !at.has(addr))) out.push(addr);
  }
  return out;
}
