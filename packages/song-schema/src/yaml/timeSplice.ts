// timeSplice.ts — inserting or deleting a stretch of time in one list of positioned items, whatever
// the unit and whatever the file: a lane's placements, a curve's points, a video lane's events.
// An item starting inside a deleted stretch goes; one at or after the cut moves by its length.

/** What a splice did — for a caller reporting it, and for refusing a no-op. */
export interface TimeSplice {
  moved: number;
  removed: number;
}

/** The list being spliced: its length, each item's position (null leaves it alone), and the two edits. */
export interface SplicedList {
  count: number;
  positionOf: (i: number) => number | null;
  remove: (i: number) => void;
  move: (i: number, to: number) => void;
}

/** Splice `len` at `at` into one list, adding what it did to `into`; descending, so a removal never shifts the next address. */
export function spliceList(
  list: SplicedList,
  at: number,
  len: number,
  mode: "insert" | "delete",
  into: TimeSplice = { moved: 0, removed: 0 },
): TimeSplice {
  if (!(len > 0)) return into;
  const end = at + len;
  for (let i = list.count - 1; i >= 0; i--) {
    const start = list.positionOf(i);
    if (start === null) continue;
    if (mode === "delete" && start >= at - 1e-6 && start < end - 1e-6) {
      list.remove(i);
      into.removed++;
      continue;
    }
    const from = mode === "delete" ? end : at;
    if (start < from - 1e-6) continue;
    list.move(i, start + (mode === "delete" ? -len : len));
    into.moved++;
  }
  return into;
}
