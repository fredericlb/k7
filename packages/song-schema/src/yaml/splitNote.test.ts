import { describe, expect, it } from "vitest";
import { splitNote } from "./sequenceFile";

// Cutting a note in two: it KEEPS its identity and its head, and a second note carries the rest (docs/noteEdits.md).

const SEQ = `notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 4, d: 2, k: 64, v: 0.7 }
`;

describe("cutting a note in two", () => {
  it("shortens the first half and writes the second", () => {
    const out = splitNote(SEQ, 64, 4, 5);
    expect(out).toContain("{ t: 4, d: 1, k: 64, v: 0.7 }");
    expect(out).toContain("{ t: 5, d: 1, k: 64, v: 0.7 }");
  });

  it("carries the VELOCITY onto both halves", () => {
    // Cutting a note in half does not make the second half quieter (docs/noteEdits.md).
    const out = splitNote(SEQ, 64, 4, 4.5);
    expect([...out.matchAll(/v: 0\.7/g)]).toHaveLength(2);
  });

  it("leaves a note with no velocity without one", () => {
    // The schema's default is 1, and a file that never mentioned velocity stays that way.
    const out = splitNote(SEQ, 60, 0, 0.25);
    expect(out).toContain("{ t: 0, d: 0.25, k: 60 }");
    expect(out).toContain("{ t: 0.25, d: 0.75, k: 60 }");
  });

  it("adds up to what it started with", () => {
    const out = splitNote(SEQ, 64, 4, 4.75);
    expect(out).toContain("{ t: 4, d: 0.75, k: 64");
    expect(out).toContain("{ t: 4.75, d: 1.25, k: 64");
  });

  it("leaves every other note alone", () => {
    expect(splitNote(SEQ, 64, 4, 5)).toContain("{ t: 0, d: 1, k: 60 }");
  });
});

describe("what it refuses", () => {
  it("a note that is not there, naming what it looked for", () => {
    expect(() => splitNote(SEQ, 60, 99, 99.5)).toThrow(/k60/);
    expect(() => splitNote(SEQ, 61, 0, 0.5)).toThrow(/k61/);
  });

  // On either edge one half would have no length, and where to cut is the caller's decision.
  it("a cut on either edge, or outside the note entirely", () => {
    expect(() => splitNote(SEQ, 64, 4, 4)).toThrow(/inside the note/);
    expect(() => splitNote(SEQ, 64, 4, 6)).toThrow(/inside the note/);
    expect(() => splitNote(SEQ, 64, 4, 9)).toThrow(/inside the note/);
    expect(() => splitNote(SEQ, 64, 4, 1)).toThrow(/inside the note/);
  });

  it("says where the note actually runs, so the refusal is actionable", () => {
    expect(() => splitNote(SEQ, 64, 4, 6)).toThrow(/4 to 6/);
  });
});
