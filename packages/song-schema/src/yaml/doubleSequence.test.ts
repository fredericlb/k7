import { describe, expect, it } from "vitest";
import { doubleSequence } from "./sequenceFile";

// Twice as long, playing twice. What a LENGTH is here is the window, and the window is stated in
// two ways — a `from`/`to` pair, or the notes' extent rounded up to the bar (docs/noteEdits.md).

const PLAIN = `notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 2.5, d: 0.5, k: 64, v: 0.8 }
`;

describe("doubling a sequence with no window of its own", () => {
  it("copies every note one BAR-ROUNDED extent later, not one last-note later", () => {
    // The notes reach beat 3, and a 4/4 sequence saying nothing is 4 beats long — the compiler's own rule.
    const out = doubleSequence(PLAIN, 4, 4);
    expect(out).toContain("{ t: 4, d: 1, k: 60 }");
    expect(out).toContain("{ t: 6.5, d: 0.5, k: 64, v: 0.8 }");
  });

  it("writes no window, because the copies double the extent on their own", () => {
    // A `to` here would say what the file already says, and would be a second thing to keep right.
    expect(doubleSequence(PLAIN, 4, 4)).not.toContain("to:");
  });

  it("reads the bar off the SIGNATURE, so 3/4 doubles by three beats", () => {
    expect(doubleSequence(PLAIN, 3, 4)).toContain("{ t: 3, d: 1, k: 60 }");
  });
});

describe("doubling a sequence that states its window", () => {
  const WINDOWED = `from: 1:1
to: 3:1
notes:
  - { t: 0, d: 1, k: 60, repeat: 2 }
  - { t: 9, d: 1, k: 62 }
`;

  it("moves `to` out by the window's length, spelled as a timecode", () => {
    // 1:1 → 3:1 is eight beats, so the far edge lands eight beats further on, at bar 5.
    expect(doubleSequence(WINDOWED, 4, 4)).toContain("to: 5:1");
  });

  it("copies what the window HOLDS and leaves what it does not", () => {
    // The rule every bulk edit here follows: a note is in when it STARTS inside.
    const out = doubleSequence(WINDOWED, 4, 4);
    expect(out).toContain("{ t: 8, d: 1, k: 60, repeat: 2 }");
    expect([...out.matchAll(/k: 62/g)]).toHaveLength(1);
  });

  it("brings a pad's effects along with the copy", () => {
    // A copied pad that lost its retrigger would be a different sound in the second half.
    expect([
      ...doubleSequence(WINDOWED, 4, 4).matchAll(/repeat: 2/g),
    ]).toHaveLength(2);
  });
});

describe("what it refuses", () => {
  it("an empty sequence, by name", () => {
    expect(() => doubleSequence("notes: []\n", 4, 4)).toThrow(/no notes/);
  });

  it("a window with nothing in it", () => {
    // Every note sits past `to`, so doubling would move nothing while making the sequence longer.
    const OUTSIDE = `from: 1:1
to: 2:1
notes:
  - { t: 8, d: 1, k: 60 }
`;
    expect(() => doubleSequence(OUTSIDE, 4, 4)).toThrow(/nothing to double/);
  });
});
