// Rewriting a RECTANGLE of notes in one pass — what the roll's four `sequence notes …` verbs run
// on. Pinned as hard as the values: the notes outside the box are byte-identical, a pad keeps its
// effects, and a region holding nothing reports 0 rather than rewriting the file for nothing.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mapNotesInRegion, type NoteIn } from "./sequenceFile";

const AUTHORED = `from: "1:1"
notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 1, d: 0.5, k: 64, v: 0.4 }
  - { t: 1, d: 0.5, k: 67, repeat: 2 }
  - { t: 4, d: 2, k: 72 }
`;

const notesOf = (text: string) => parse(text, { version: "1.2" }).notes;
/** The whole authored range, for a test that is about the FUNCTION rather than about the box. */
const ALL = { loKey: 0, hiKey: 127, from: 0, to: 8 };

describe("which notes a region holds", () => {
  it("takes a note that STARTS inside, whatever its length does past the far edge", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 0, hiKey: 127, from: 4, to: 5 },
      (n) => ({ ...n, k: n.k + 1 }),
    );
    expect(got.changed).toBe(1);
    expect(notesOf(got.text)[3].k).toBe(73);
  });

  it("leaves out a note that merely runs through it", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 0, hiKey: 127, from: 5, to: 6 },
      (n) => ({ ...n, k: n.k + 1 }),
    );
    expect(got.changed).toBe(0);
  });

  it("takes both keys, INCLUSIVE", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 64, hiKey: 67, from: 0, to: 8 },
      (n) => ({ ...n, k: n.k + 12 }),
    );
    expect(got.changed).toBe(2);
    expect(notesOf(got.text).map((n: NoteIn) => n.k)).toEqual([60, 76, 79, 72]);
  });

  it("reports 0 and hands the text BACK for a region holding nothing", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 0, hiKey: 40, from: 0, to: 8 },
      () => null,
    );
    expect(got.changed).toBe(0);
    expect(got.text).toBe(AUTHORED);
  });

  it("says the same of a file with no notes at all", () => {
    expect(mapNotesInRegion('from: "1:1"\n', ALL, () => null)).toEqual({
      text: 'from: "1:1"\n',
      changed: 0,
    });
  });
});

describe("what it writes", () => {
  it("removes every note the box holds, on null", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 0, hiKey: 127, from: 0, to: 2 },
      () => null,
    );
    expect(got.changed).toBe(3);
    expect(notesOf(got.text)).toEqual([{ t: 4, d: 2, k: 72 }]);
  });

  it("keeps the notes OUTSIDE the box byte-identical", () => {
    const got = mapNotesInRegion(
      AUTHORED,
      { loKey: 60, hiKey: 60, from: 0, to: 8 },
      (n) => ({ ...n, t: n.t + 8 }),
    );
    expect(got.text).toContain("- { t: 1, d: 0.5, k: 64, v: 0.4 }");
    expect(got.text).toContain("- { t: 1, d: 0.5, k: 67, repeat: 2 }");
    // …and the header the file opened with, which no note edit has any business touching.
    expect(got.text.startsWith('from: "1:1"\n')).toBe(true);
  });

  it("leaves a pad's effects alone while changing its pitch", () => {
    const got = mapNotesInRegion(AUTHORED, ALL, (n) => ({ ...n, k: n.k + 1 }));
    expect(notesOf(got.text)[2]).toEqual({ t: 1, d: 0.5, k: 68, repeat: 2 });
  });

  it("CLEARS the velocity key rather than writing the schema's own default back", () => {
    const got = mapNotesInRegion(AUTHORED, ALL, (n) => ({
      ...n,
      v: undefined,
    }));
    expect(got.text).not.toContain("v:");
    expect(notesOf(got.text)[1]).toEqual({ t: 1, d: 0.5, k: 64 });
  });

  it("writes a velocity onto a note that had none", () => {
    const got = mapNotesInRegion(AUTHORED, ALL, (n) => ({ ...n, v: 0.8 }));
    expect(notesOf(got.text).map((n: NoteIn) => n.v)).toEqual([
      0.8, 0.8, 0.8, 0.8,
    ]);
  });

  it("refuses a rewrite that would make a note nothing can play", () => {
    expect(() =>
      mapNotesInRegion(AUTHORED, ALL, (n) => ({ ...n, d: 0 })),
    ).toThrow(/nothing can play/);
    expect(() =>
      mapNotesInRegion(AUTHORED, ALL, (n) => ({ ...n, k: 200 })),
    ).toThrow(/nothing can play/);
  });

  it("deletes from the back, so several removals in one pass all land", () => {
    const got = mapNotesInRegion(AUTHORED, ALL, (n) => (n.k === 72 ? n : null));
    expect(notesOf(got.text)).toEqual([{ t: 4, d: 2, k: 72 }]);
  });
});
