import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { doubleSequence, editSequence } from "./sequenceFile";

// Twice as long, playing twice. What a LENGTH is here is the window, and the window is stated in
// two ways — a `from`/`to` pair, or the notes' extent rounded up to the bar (docs/noteEdits.md).

const PLAIN = `notes([
  t(0).d(1).k(60),
  t(2.5).d(0.5).k(64).v(0.8),
])
`;

const double = (text: string, num: number, den: number): string =>
  editSequence(text, (d) => doubleSequence(d, num, den)).text;
const notesOf = (text: string) =>
  parse(text).notes as Record<string, unknown>[];

describe("doubling a sequence with no window of its own", () => {
  it("copies every note one BAR-ROUNDED extent later, not one last-note later", () => {
    // The notes reach beat 3, and a 4/4 sequence saying nothing is 4 beats long — the compiler's own rule.
    expect(notesOf(double(PLAIN, 4, 4)).slice(2)).toEqual([
      { t: 4, d: 1, k: 60 },
      { t: 6.5, d: 0.5, k: 64, v: 0.8 },
    ]);
  });

  it("writes no window, because the copies double the extent on their own", () => {
    // A `to` here would say what the file already says, and would be a second thing to keep right.
    expect(parse(double(PLAIN, 4, 4)).to).toBeUndefined();
  });

  it("reads the bar off the SIGNATURE, so 3/4 doubles by three beats", () => {
    expect(notesOf(double(PLAIN, 3, 4))[2]).toEqual({ t: 3, d: 1, k: 60 });
  });

  it("appends each copy on a line of its own", () => {
    expect(double(PLAIN, 4, 4)).toContain("  t(4).d(1).k(60),\n");
  });
});

describe("doubling a sequence that states its window", () => {
  const WINDOWED = `from("1:1")
to("3:1")
notes([
  t(0).d(1).k(60).repeat(2),
  t(9).d(1).k(62),
])
`;

  it("moves `to` out by the window's length, spelled as a timecode", () => {
    // 1:1 → 3:1 is eight beats, so the far edge lands eight beats further on, at bar 5.
    expect(parse(double(WINDOWED, 4, 4)).to).toBe("5:1");
  });

  it("copies what the window HOLDS and leaves what it does not", () => {
    // The rule every bulk edit here follows: a note is in when it STARTS inside.
    const notes = notesOf(double(WINDOWED, 4, 4));
    expect(notes[2]).toEqual({ t: 8, d: 1, k: 60, repeat: 2 });
    expect(notes.filter((n) => n.k === 62)).toHaveLength(1);
  });

  it("brings a pad's effects along with the copy", () => {
    // A copied pad that lost its retrigger would be a different sound in the second half.
    const notes = notesOf(double(WINDOWED, 4, 4));
    expect(notes.filter((n) => n.repeat === 2)).toHaveLength(2);
  });
});

describe("what it refuses", () => {
  it("an empty sequence, by name", () => {
    expect(() => double("notes([])\n", 4, 4)).toThrow(/no notes/);
  });

  it("a window with nothing in it", () => {
    // Every note sits past `to`, so doubling would move nothing while making the sequence longer.
    const OUTSIDE = `from("1:1")
to("2:1")
notes([t(8).d(1).k(60)])
`;
    expect(() => double(OUTSIDE, 4, 4)).toThrow(/nothing to double/);
  });
});
