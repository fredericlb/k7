import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { editSequence, setNoteTimeRange } from "./sequenceFile";

// Moving a note and stretching it are ONE writer, addressed by key and CURRENT start (docs/noteEdits.md).

const SEQ = `notes([
  t(0).d(1).k(60),
  t(4).d(2).k(64).v(0.7),
])
`;

const range = (k: number, t: number, newT: number, newD: number) =>
  editSequence(SEQ, (d) => setNoteTimeRange(d, k, t, newT, newD)).text;
const notesOf = (text: string) =>
  parse(text).notes as Record<string, unknown>[];

describe("moving a note", () => {
  it("writes the new start and keeps the length, and everything else the note carries", () => {
    // Velocity is not this gesture's business, so resetting it would be a second edit.
    expect(notesOf(range(64, 4, 6, 2))[1]).toEqual({
      t: 6,
      d: 2,
      k: 64,
      v: 0.7,
    });
  });

  it("leaves the other notes alone", () => {
    expect(range(64, 4, 6, 2)).toContain("  t(0).d(1).k(60),\n");
  });
});

describe("stretching a note", () => {
  it("keeps the start and writes the new length", () => {
    expect(notesOf(range(60, 0, 0, 3))[0]).toEqual({ t: 0, d: 3, k: 60 });
  });
});

describe("what it refuses", () => {
  it("refuses a note that is not there, naming what it looked for", () => {
    expect(() => range(60, 99, 0, 1)).toThrow(/k60.*99/);
    expect(() => range(61, 0, 0, 1)).toThrow(/k61/);
  });

  it("refuses a length of nothing rather than writing a note that cannot sound", () => {
    expect(() => range(60, 0, 0, 0)).toThrow(/longer than/);
    expect(() => range(60, 0, 0, -1)).toThrow(/longer than/);
  });

  it("refuses a start before the sequence begins", () => {
    expect(() => range(60, 0, -1, 1)).toThrow(/before/);
  });
});
