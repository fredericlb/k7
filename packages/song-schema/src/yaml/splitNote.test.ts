import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { editSequence, splitNote } from "./sequenceFile";

// Cutting a note in two: it KEEPS its identity and its head, and a second note carries the rest (docs/noteEdits.md).

const SEQ = `notes([
  t(0).d(1).k(60),
  t(4).d(2).k(64).v(0.7),
])
`;

const split = (k: number, t: number, at: number) =>
  editSequence(SEQ, (d) => splitNote(d, k, t, at)).text;
const notesOf = (text: string) =>
  parse(text).notes as Record<string, unknown>[];

describe("cutting a note in two", () => {
  it("shortens the first half and writes the second, VELOCITY carried onto both", () => {
    // Cutting a note in half does not make the second half quieter (docs/noteEdits.md).
    expect(notesOf(split(64, 4, 5)).slice(1)).toEqual([
      { t: 4, d: 1, k: 64, v: 0.7 },
      { t: 5, d: 1, k: 64, v: 0.7 },
    ]);
  });

  it("leaves a note with no velocity without one", () => {
    // The schema's default is 1, and a file that never mentioned velocity stays that way.
    const notes = notesOf(split(60, 0, 0.25));
    expect(notes[0]).toEqual({ t: 0, d: 0.25, k: 60 });
    expect(notes[2]).toEqual({ t: 0.25, d: 0.75, k: 60 });
  });

  it("adds up to what it started with", () => {
    const notes = notesOf(split(64, 4, 4.75));
    expect(notes[1]).toMatchObject({ t: 4, d: 0.75, k: 64 });
    expect(notes[2]).toMatchObject({ t: 4.75, d: 1.25, k: 64 });
  });

  it("leaves every other note alone", () => {
    expect(split(64, 4, 5)).toContain("  t(0).d(1).k(60),\n");
  });
});

describe("what it refuses", () => {
  it("a note that is not there, naming what it looked for", () => {
    expect(() => split(60, 99, 99.5)).toThrow(/k60/);
    expect(() => split(61, 0, 0.5)).toThrow(/k61/);
  });

  // On either edge one half would have no length, and where to cut is the caller's decision.
  it("a cut on either edge, or outside the note entirely", () => {
    expect(() => split(64, 4, 4)).toThrow(/inside the note/);
    expect(() => split(64, 4, 6)).toThrow(/inside the note/);
    expect(() => split(64, 4, 9)).toThrow(/inside the note/);
    expect(() => split(64, 4, 1)).toThrow(/inside the note/);
  });

  it("says where the note actually runs, so the refusal is actionable", () => {
    expect(() => split(64, 4, 6)).toThrow(/4 to 6/);
  });
});
