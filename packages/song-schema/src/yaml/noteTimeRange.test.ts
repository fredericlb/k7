import { describe, expect, it } from "vitest";
import { setNoteTimeRange } from "./sequenceFile";

// Moving a note and stretching it are ONE writer, because on the roll they are one gesture with
// two grips: the body slides it, the right edge stretches it. Two writers would be two answers to
// "which note is this", and the second would eventually disagree with the first.
//
// A note is addressed by its key and its CURRENT start — a pitch and a place are what a roll can
// point at, and a note has no id of its own.

const SEQ = `notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 4, d: 2, k: 64, v: 0.7 }
`;

describe("moving a note", () => {
  it("writes the new start and keeps the length", () => {
    const out = setNoteTimeRange(SEQ, 64, 4, 6, 2);
    expect(out).toContain("t: 6");
    expect(out).toContain("d: 2");
  });

  it("leaves everything else the note carries", () => {
    // Velocity is not this gesture's business, and a move that silently reset it would be a
    // second edit nobody asked for.
    expect(setNoteTimeRange(SEQ, 64, 4, 6, 2)).toContain("v: 0.7");
  });

  it("leaves the other notes alone", () => {
    const out = setNoteTimeRange(SEQ, 64, 4, 6, 2);
    expect(out).toContain("{ t: 0, d: 1, k: 60 }");
  });
});

describe("stretching a note", () => {
  it("keeps the start and writes the new length", () => {
    expect(setNoteTimeRange(SEQ, 60, 0, 0, 3)).toContain("t: 0");
    expect(setNoteTimeRange(SEQ, 60, 0, 0, 3)).toContain("d: 3");
  });
});

describe("what it refuses", () => {
  it("refuses a note that is not there, naming what it looked for", () => {
    expect(() => setNoteTimeRange(SEQ, 60, 99, 0, 1)).toThrow(/k60.*99/);
    expect(() => setNoteTimeRange(SEQ, 61, 0, 0, 1)).toThrow(/k61/);
  });

  it("refuses a length of nothing rather than writing a note that cannot sound", () => {
    expect(() => setNoteTimeRange(SEQ, 60, 0, 0, 0)).toThrow(/longer than/);
    expect(() => setNoteTimeRange(SEQ, 60, 0, 0, -1)).toThrow(/longer than/);
  });

  it("refuses a start before the sequence begins", () => {
    expect(() => setNoteTimeRange(SEQ, 60, 0, -1, 1)).toThrow(/before/);
  });
});
