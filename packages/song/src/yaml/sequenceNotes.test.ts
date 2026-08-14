// Addressing ONE note in a sequence and rewriting its velocity — what the piano roll's velocity
// drag commits. The file is hand-edited and in git, so what is pinned as hard as the value is the
// shape: one note per line, the other notes untouched, and no `v: 1` written where the schema's
// default already says it.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SequenceSchema } from "./entitySchemas";
import { findNote, setNoteVelocity } from "./sequenceFile";

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
    // Dragged back to full, a note loses a field it never had — the schema's default is 1, and a
    // file that never mentions velocity should stay byte-identical.
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
