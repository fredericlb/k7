// Addressing ONE note in a sequence and rewriting its velocity — what the piano roll's velocity
// drag commits. The file is hand-edited, so what is pinned as hard as the value is the shape: one
// note per line, the other notes untouched, no `v(1)` written where the schema's default already
// says it, and a short form kept or written in full by sugar's rule.

import { K7Document, type K7Scope, parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { SequenceSchema } from "./entitySchemas";
import {
  editSequence,
  findNote,
  moveNote,
  moveNotes,
  removeNote,
  setNoteVelocity,
} from "./sequenceFile";

const AUTHORED = `from("1:1")
notes([
  t(0).d(1).k(60),
  t(1).d(0.5).k(64).v(0.4),
  t(1).d(0.5).k(67),
])
`;

const scope = (text: string) => new K7Document(text).at([]);
const edit = (text: string, fn: (doc: K7Scope) => void): string =>
  editSequence(text, fn).text;
const notesOf = (text: string) =>
  parse(text).notes as Record<string, unknown>[];
const valid = (text: string) => SequenceSchema.safeParse(parse(text)).success;

describe("findNote", () => {
  it("addresses a note by key and start", () => {
    expect(findNote(scope(AUTHORED), 60, 0)).toBe(0);
    expect(findNote(scope(AUTHORED), 64, 1)).toBe(1);
    // Same beat, another key: the pair is what tells two stacked notes apart.
    expect(findNote(scope(AUTHORED), 67, 1)).toBe(2);
  });

  it("answers -1 for a note that is not there", () => {
    expect(findNote(scope(AUTHORED), 60, 3)).toBe(-1);
    expect(findNote(scope(AUTHORED), 61, 0)).toBe(-1);
    expect(findNote(scope('from("1:1")\n'), 60, 0)).toBe(-1);
  });

  it("matches a start a surface computed, not one it typed", () => {
    // Beats arrive as decimals from a pixel position; an exact-equality match would miss.
    const text = "notes([t(0.3333333).d(1).k(60)])\n";
    expect(findNote(scope(text), 60, 0.33333335)).toBe(0);
  });

  it("reads a short form as the notes it expands to", () => {
    expect(findNote(scope('notes("c4 e4")\n'), 64, 1)).toBe(1);
  });
});

describe("removeNote", () => {
  it("removes exactly the note addressed and leaves the others alone", () => {
    const after = edit(AUTHORED, (d) => removeNote(d, 64, 1));
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 67 },
    ]);
    expect(valid(after)).toBe(true);
  });

  it("tells two stacked notes apart by their key", () => {
    // Both start at beat 1; only the addressed key goes.
    const after = edit(AUTHORED, (d) => removeNote(d, 67, 1));
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 64, v: 0.4 },
    ]);
  });

  it("refuses a note it cannot find, rather than removing something else", () => {
    expect(() => edit(AUTHORED, (d) => removeNote(d, 60, 9))).toThrow(
      /no note/,
    );
  });

  it("keeps everything else in the file", () => {
    expect(edit(AUTHORED, (d) => removeNote(d, 60, 0))).toContain(
      'from("1:1")',
    );
  });
});

describe("setNoteVelocity", () => {
  it("writes the velocity and leaves the other notes alone", () => {
    const after = edit(AUTHORED, (d) => setNoteVelocity(d, 60, 0, 0.75));
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60, v: 0.75 },
      { t: 1, d: 0.5, k: 64, v: 0.4 },
      { t: 1, d: 0.5, k: 67 },
    ]);
    // One note per line, still.
    expect(after).toContain("  t(0).d(1).k(60).v(0.75),\n");
    expect(valid(after)).toBe(true);
  });

  it("replaces a velocity the note already had", () => {
    const after = edit(AUTHORED, (d) => setNoteVelocity(d, 64, 1, 0.9));
    expect(notesOf(after)[1]).toEqual({ t: 1, d: 0.5, k: 64, v: 0.9 });
  });

  it("CLEARS the key rather than writing the default", () => {
    // Dragged back to full, a note loses a field it never had — the schema's default is 1.
    const after = edit(AUTHORED, (d) => setNoteVelocity(d, 64, 1, undefined));
    expect(notesOf(after)[1]).toEqual({ t: 1, d: 0.5, k: 64 });
    expect(after).not.toContain("v(");
  });

  it("refuses a note it cannot find, rather than writing somewhere else", () => {
    expect(() => edit(AUTHORED, (d) => setNoteVelocity(d, 60, 9, 0.5))).toThrow(
      /no note/,
    );
  });

  it("keeps everything else in the file, comments included", () => {
    const withComments = `// the melody
notes([
  // the downbeat
  t(0).d(1).k(60),
])
`;
    const after = edit(withComments, (d) => setNoteVelocity(d, 60, 0, 0.5));
    expect(after).toContain("// the melody");
    expect(after).toContain("// the downbeat");
  });
});

describe("a sequence written in the short form", () => {
  it("keeps the short form while an edit leaves its notes as they were", () => {
    const text = 'notes("c4 e4")\n';
    expect(edit(text, (d) => setNoteVelocity(d, 60, 0, undefined))).toBe(text);
  });

  it("writes the notes in full once an edit changes them", () => {
    const after = edit('notes("c4 e4")\n', (d) =>
      setNoteVelocity(d, 64, 1, 0.5),
    );
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 64, v: 0.5 },
    ]);
  });

  it("is refused by a writer handed the document as written", () => {
    expect(() =>
      setNoteVelocity(scope('notes("c4 e4")\n'), 60, 0, 0.5),
    ).toThrow(/short form/);
  });
});

// Moving a note to another pad keeps its length and its velocity — it is the same note (docs/noteEdits.md).
describe("moveNote", () => {
  it("carries the note's length and velocity to the new key and start", () => {
    const after = edit(AUTHORED, (d) => moveNote(d, 64, 1, 60, 2.5));
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 2.5, d: 0.5, k: 60, v: 0.4 }, // v and d rode along
      { t: 1, d: 0.5, k: 67 },
    ]);
    expect(valid(after)).toBe(true);
  });

  it("moves within one key, and to another key at the same beat", () => {
    const later = edit(AUTHORED, (d) => moveNote(d, 60, 0, 60, 3));
    expect(notesOf(later)[0]).toEqual({ t: 3, d: 1, k: 60 });
    const up = edit(AUTHORED, (d) => moveNote(d, 60, 0, 62, 0));
    expect(notesOf(up)[0]).toEqual({ t: 0, d: 1, k: 62 });
  });

  it("refuses a destination that already holds one — (key, start) is the address", () => {
    // k67 already starts at 1: landing there would make two notes the same note.
    expect(() => edit(AUTHORED, (d) => moveNote(d, 60, 0, 67, 1))).toThrow(
      /already/,
    );
  });

  it("accepts a move that lands exactly where it started", () => {
    const same = edit(AUTHORED, (d) => moveNote(d, 60, 0, 60, 0));
    expect(notesOf(same)[0]).toEqual({ t: 0, d: 1, k: 60 });
  });

  it("refuses a note it cannot find, and a start before the sequence", () => {
    expect(() => edit(AUTHORED, (d) => moveNote(d, 60, 9, 61, 0))).toThrow(
      /no note/,
    );
    expect(() => edit(AUTHORED, (d) => moveNote(d, 60, 0, 61, -1))).toThrow(
      /before/,
    );
  });
});

describe("moveNotes", () => {
  it("moves every note in one pass, each to its own place, length and velocity riding along", () => {
    const after = edit(AUTHORED, (d) =>
      moveNotes(d, [
        { k: 60, t: 0, nk: 62, nt: 2 },
        { k: 64, t: 1, nk: 65, nt: 3 },
      ]),
    );
    expect(notesOf(after)).toEqual([
      { t: 2, d: 1, k: 62 },
      { t: 3, d: 0.5, k: 65, v: 0.4 },
      { t: 1, d: 0.5, k: 67 }, // not moved, not touched
    ]);
  });

  it("lands on a place another MOVING note leaves — a selection shifted onto itself", () => {
    // k64 moves onto k67's beat while k67 moves away: neither collides with the other.
    const after = edit(AUTHORED, (d) =>
      moveNotes(d, [
        { k: 64, t: 1, nk: 67, nt: 1 },
        { k: 67, t: 1, nk: 67, nt: 2 },
      ]),
    );
    expect(notesOf(after)).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 0.5, k: 67, v: 0.4 },
      { t: 2, d: 0.5, k: 67 },
    ]);
  });

  it("refuses a place a note that STAYS already holds, and writes nothing", () => {
    expect(() =>
      edit(AUTHORED, (d) => moveNotes(d, [{ k: 64, t: 1, nk: 60, nt: 0 }])),
    ).toThrow(/already/);
  });

  it("refuses two notes landing on one place, a missing note, and a start before the sequence", () => {
    const moving = (moves: Parameters<typeof moveNotes>[1]) => () =>
      edit(AUTHORED, (d) => moveNotes(d, moves));
    expect(
      moving([
        { k: 60, t: 0, nk: 70, nt: 4 },
        { k: 64, t: 1, nk: 70, nt: 4 },
      ]),
    ).toThrow(/two notes/);
    expect(moving([{ k: 61, t: 0, nk: 62, nt: 0 }])).toThrow(/no note/);
    expect(moving([{ k: 60, t: 0, nk: 60, nt: -1 }])).toThrow(/before/);
    expect(moving([])).toThrow(/no note/);
  });
});
