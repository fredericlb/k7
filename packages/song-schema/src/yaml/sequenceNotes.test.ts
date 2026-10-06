// Addressing ONE note in a sequence and rewriting its velocity — what the piano roll's velocity
// drag commits. The file is hand-edited and in git, so what is pinned as hard as the value is the
// shape: one note per line, the other notes untouched, and no `v: 1` written where the schema's
// default already says it.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SequenceSchema } from "./entitySchemas";
import {
  findNote,
  moveNote,
  moveNotes,
  removeNote,
  setNoteVelocity,
} from "./sequenceFile";

const AUTHORED = `from: "1:1"
notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 1, d: 0.5, k: 64, v: 0.4 }
  - { t: 1, d: 0.5, k: 67 }
`;

const notesOf = (text: string) => parse(text, { version: "1.2" }).notes;

describe("findNote", () => {
  it("addresses a note by key and start", () => {
    expect(findNote(AUTHORED, 60, 0)).toBe(0);
    expect(findNote(AUTHORED, 64, 1)).toBe(1);
    // Same beat, another key: the pair is what tells two stacked notes apart.
    expect(findNote(AUTHORED, 67, 1)).toBe(2);
  });

  it("answers -1 for a note that is not there", () => {
    expect(findNote(AUTHORED, 60, 3)).toBe(-1);
    expect(findNote(AUTHORED, 61, 0)).toBe(-1);
    expect(findNote('from: "1:1"\n', 60, 0)).toBe(-1);
  });

  it("matches a start a surface computed, not one it typed", () => {
    // Beats arrive as decimals from a pixel position; an exact-equality match would miss.
    const text = "notes:\n  - { t: 0.3333333, d: 1, k: 60 }\n";
    expect(findNote(text, 60, 0.33333335)).toBe(0);
  });
});

describe("removeNote", () => {
  it("removes exactly the note addressed and leaves the others alone", () => {
    const after = removeNote(AUTHORED, 64, 1);
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 67 },
    ]);
    expect(
      SequenceSchema.safeParse(parse(after, { version: "1.2" })).success,
    ).toBe(true);
  });

  it("tells two stacked notes apart by their key", () => {
    // Both start at beat 1; only the addressed key goes.
    const after = removeNote(AUTHORED, 67, 1);
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 64, v: 0.4 },
    ]);
  });

  it("refuses a note it cannot find, rather than removing something else", () => {
    expect(() => removeNote(AUTHORED, 60, 9)).toThrow(/no note/);
  });

  it("keeps everything else in the file", () => {
    const after = removeNote(AUTHORED, 60, 0);
    expect(after).toContain('from: "1:1"');
  });
});

describe("setNoteVelocity", () => {
  it("writes the velocity and leaves the other notes alone", () => {
    const after = setNoteVelocity(AUTHORED, 60, 0, 0.75);
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60, v: 0.75 },
      { t: 1, d: 0.5, k: 64, v: 0.4 },
      { t: 1, d: 0.5, k: 67 },
    ]);
    // One note per line, still.
    expect(after).toContain("- { t: 0, d: 1, k: 60, v: 0.75 }");
    expect(
      SequenceSchema.safeParse(parse(after, { version: "1.2" })).success,
    ).toBe(true);
  });

  it("replaces a velocity the note already had", () => {
    expect(notesOf(setNoteVelocity(AUTHORED, 64, 1, 0.9))[1]).toEqual({
      t: 1,
      d: 0.5,
      k: 64,
      v: 0.9,
    });
  });

  it("CLEARS the key rather than writing the default", () => {
    // Dragged back to full, a note loses a field it never had — the schema's default is 1.
    const after = setNoteVelocity(AUTHORED, 64, 1, undefined);
    expect(notesOf(after)[1]).toEqual({ t: 1, d: 0.5, k: 64 });
    expect(after).not.toContain("v:");
  });

  it("refuses a note it cannot find, rather than writing somewhere else", () => {
    expect(() => setNoteVelocity(AUTHORED, 60, 9, 0.5)).toThrow(/no note/);
  });

  it("keeps everything else in the file, comments included", () => {
    const withComments = `# the melody
notes:
  # the downbeat
  - { t: 0, d: 1, k: 60 }
`;
    const after = setNoteVelocity(withComments, 60, 0, 0.5);
    expect(after).toContain("# the melody");
    expect(after).toContain("# the downbeat");
  });
});

// Moving a note to another pad keeps its length and its velocity — it is the same note (docs/noteEdits.md).
describe("moveNote", () => {
  it("carries the note's length and velocity to the new key and start", () => {
    const after = moveNote(AUTHORED, 64, 1, 60, 2.5);
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 2.5, d: 0.5, k: 60, v: 0.4 }, // v and d rode along
      { t: 1, d: 0.5, k: 67 },
    ]);
    expect(
      SequenceSchema.safeParse(parse(after, { version: "1.2" })).success,
    ).toBe(true);
  });

  it("moves within one key, and to another key at the same beat", () => {
    expect(notesOf(moveNote(AUTHORED, 60, 0, 60, 3))[0]).toEqual({
      t: 3,
      d: 1,
      k: 60,
    });
    expect(notesOf(moveNote(AUTHORED, 60, 0, 62, 0))[0]).toEqual({
      t: 0,
      d: 1,
      k: 62,
    });
  });

  it("refuses a destination that already holds one — (key, start) is the address", () => {
    // k67 already starts at 1: landing there would make two notes the same note.
    expect(() => moveNote(AUTHORED, 60, 0, 67, 1)).toThrow(/already/);
  });

  it("accepts a move that lands exactly where it started", () => {
    expect(notesOf(moveNote(AUTHORED, 60, 0, 60, 0))[0]).toEqual({
      t: 0,
      d: 1,
      k: 60,
    });
  });

  it("refuses a note it cannot find, and a start before the sequence", () => {
    expect(() => moveNote(AUTHORED, 60, 9, 61, 0)).toThrow(/no note/);
    expect(() => moveNote(AUTHORED, 60, 0, 61, -1)).toThrow(/before/);
  });
});

describe("moveNotes", () => {
  it("moves every note in one pass, each to its own place, length and velocity riding along", () => {
    const after = moveNotes(AUTHORED, [
      { k: 60, t: 0, nk: 62, nt: 2 },
      { k: 64, t: 1, nk: 65, nt: 3 },
    ]);
    expect(notesOf(after)).toEqual([
      { t: 2, d: 1, k: 62 },
      { t: 3, d: 0.5, k: 65, v: 0.4 },
      { t: 1, d: 0.5, k: 67 }, // not moved, not touched
    ]);
  });

  it("lands on a place another MOVING note leaves — a selection shifted onto itself", () => {
    // k64 moves onto k67's beat while k67 moves away: neither collides with the other.
    const after = moveNotes(AUTHORED, [
      { k: 64, t: 1, nk: 67, nt: 1 },
      { k: 67, t: 1, nk: 67, nt: 2 },
    ]);
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 67, v: 0.4 },
      { t: 2, d: 0.5, k: 67 },
    ]);
  });

  it("refuses a place a note that STAYS already holds, and writes nothing", () => {
    expect(() => moveNotes(AUTHORED, [{ k: 64, t: 1, nk: 60, nt: 0 }])).toThrow(
      /already/,
    );
  });

  it("refuses two notes landing on one place, a missing note, and a start before the sequence", () => {
    expect(() =>
      moveNotes(AUTHORED, [
        { k: 60, t: 0, nk: 70, nt: 4 },
        { k: 64, t: 1, nk: 70, nt: 4 },
      ]),
    ).toThrow(/two notes/);
    expect(() => moveNotes(AUTHORED, [{ k: 61, t: 0, nk: 62, nt: 0 }])).toThrow(
      /no note/,
    );
    expect(() =>
      moveNotes(AUTHORED, [{ k: 60, t: 0, nk: 60, nt: -1 }]),
    ).toThrow(/before/);
    expect(() => moveNotes(AUTHORED, [])).toThrow(/no note/);
  });
});
