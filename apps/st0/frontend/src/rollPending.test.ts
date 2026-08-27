import { describe, expect, it } from "vitest";
import {
  noteAddr,
  paintNotes,
  type RollNote,
  settledNotes,
} from "./rollPending";

const n = (
  key: number,
  time: number,
  duration = 1,
  vel?: number,
): RollNote => ({
  key,
  time,
  duration,
  ...(vel === undefined ? {} : { vel }),
});

const DOC = [n(60, 0), n(64, 1), n(67, 2)];
const ghosts = (...pairs: [string, RollNote | null][]) => new Map(pairs);
const addrs = (ns: RollNote[]) => ns.map((x) => noteAddr(x.key, x.time)).sort();

describe("noteAddr", () => {
  it("is the pair every note verb takes", () => {
    expect(noteAddr(60, 1.5)).toBe("60@1.5");
  });

  it("rounds a beat a surface computed, so two ways of arriving agree", () => {
    expect(noteAddr(60, 1.0000000001)).toBe(noteAddr(60, 1));
  });
});

describe("paintNotes", () => {
  it("hands the document straight back when nothing is in flight", () => {
    expect(paintNotes(DOC, new Map())).toBe(DOC);
  });

  it("adds a note the document has not heard of yet", () => {
    const out = paintNotes(DOC, ghosts([noteAddr(72, 4), n(72, 4)]));
    expect(addrs(out)).toEqual(["60@0", "64@1", "67@2", "72@4"]);
  });

  it("takes one away", () => {
    const out = paintNotes(DOC, ghosts([noteAddr(64, 1), null]));
    expect(addrs(out)).toEqual(["60@0", "67@2"]);
  });

  it("replaces one in place — a stretch, or a velocity", () => {
    const out = paintNotes(DOC, ghosts([noteAddr(64, 1), n(64, 1, 3, 0.4)]));
    expect(out).toHaveLength(3);
    expect(out.find((x) => x.key === 64)).toEqual({
      key: 64,
      time: 1,
      duration: 3,
      vel: 0.4,
    });
  });

  it("moves one, gone from where it was and there instead — ONE ghost", () => {
    const out = paintNotes(DOC, ghosts([noteAddr(64, 1), n(71, 5)]));
    expect(addrs(out)).toEqual(["60@0", "67@2", "71@5"]);
  });

  it("takes a whole rectangle away at once", () => {
    const out = paintNotes(
      DOC,
      ghosts([noteAddr(60, 0), null], [noteAddr(64, 1), null]),
    );
    expect(addrs(out)).toEqual(["67@2"]);
  });
});

describe("settledNotes", () => {
  it("settles a removal once the note is gone", () => {
    const g = ghosts([noteAddr(64, 1), null]);
    expect(settledNotes(DOC, g)).toEqual([]);
    expect(settledNotes([n(60, 0), n(67, 2)], g)).toEqual(["64@1"]);
  });

  it("settles an addition once the note is there", () => {
    const g = ghosts([noteAddr(72, 4), n(72, 4)]);
    expect(settledNotes(DOC, g)).toEqual([]);
    expect(settledNotes([...DOC, n(72, 4)], g)).toEqual(["72@4"]);
  });

  it("holds a stretch until the LENGTH lands, not merely the note", () => {
    const g = ghosts([noteAddr(64, 1), n(64, 1, 3)]);
    expect(settledNotes(DOC, g)).toEqual([]);
    expect(settledNotes([n(60, 0), n(64, 1, 3), n(67, 2)], g)).toEqual([
      "64@1",
    ]);
  });

  it("holds a velocity until the VALUE lands, absent counting as 1", () => {
    const g = ghosts([noteAddr(60, 0), n(60, 0, 1, 0.5)]);
    expect(settledNotes(DOC, g)).toEqual([]);
    expect(settledNotes([n(60, 0, 1, 0.5), n(64, 1), n(67, 2)], g)).toEqual([
      "60@0",
    ]);
  });

  it("settles a clear of the velocity: the file saying nothing IS 1", () => {
    const g = ghosts([noteAddr(60, 0), n(60, 0)]);
    expect(settledNotes([n(60, 0, 1, 1), n(64, 1)], g)).toEqual(["60@0"]);
  });

  it("holds a move until BOTH halves land", () => {
    const g = ghosts([noteAddr(64, 1), n(71, 5)]);
    // Arrived, but the old one is still in the document — a half-read of the reload, not a settled edit.
    expect(settledNotes([...DOC, n(71, 5)], g)).toEqual([]);
    expect(settledNotes([n(60, 0), n(67, 2), n(71, 5)], g)).toEqual(["64@1"]);
  });

  it("settles each ghost on its own, so a slow one does not hold the rest", () => {
    const g = ghosts([noteAddr(60, 0), null], [noteAddr(64, 1), null]);
    expect(settledNotes([n(64, 1), n(67, 2)], g)).toEqual(["60@0"]);
  });
});
