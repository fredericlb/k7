import { describe, expect, it } from "vitest";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parseLegacyPosition,
  parsePosition,
  TICKS_PER_QUARTER,
} from "./timecode";

// The model measures time in beats = quarter notes. A metrical beat is 4/den
// quarter notes; a bar is num such beats. Positions are 1-based ("1:1:1" == start),
// durations 0-based ("1:0:0" == one bar).

describe("parsePosition", () => {
  it("reads a 1-based MESURE:NOIRE:CROCHE:DOUBLECROCHE in 4/4", () => {
    expect(parsePosition("1:1:1:1", 4, 4)).toBe(0); // the very start
    expect(parsePosition("2:1:1:1", 4, 4)).toBe(4); // top of bar 2 = 4 beats
    expect(parsePosition("1:2:1:1", 4, 4)).toBe(1); // 2nd crotchet of bar 1
    expect(parsePosition("1:1:2:1", 4, 4)).toBe(0.5); // 2nd quaver = half a beat
    expect(parsePosition("1:1:1:2", 4, 4)).toBe(0.25); // 2nd semiquaver
    expect(parsePosition("1:1:2:2", 4, 4)).toBe(0.75); // a quaver and a semiquaver
  });

  it("takes a missing trailing level as that level's origin", () => {
    expect(parsePosition("2:1", 4, 4)).toBe(parsePosition("2:1:1:1", 4, 4));
    expect(parsePosition("1:1:2", 4, 4)).toBe(parsePosition("1:1:2:1", 4, 4));
  });

  it("scales the beat by the denominator (6/8 => a beat is an eighth)", () => {
    // den 8 => q = 0.5 quarter notes per beat; a 6/8 bar = 3 quarter notes.
    expect(parsePosition("2:1:1", 6, 8)).toBe(3);
    expect(parsePosition("1:2:1", 6, 8)).toBe(0.5);
  });
});

describe("parseDuration", () => {
  it("counts 0-based in the same units", () => {
    expect(parseDuration("0:0:0:0", 4, 4)).toBe(0);
    expect(parseDuration("1:0:0:0", 4, 4)).toBe(4); // one bar
    expect(parseDuration("0:1:0:0", 4, 4)).toBe(1); // one beat
    expect(parseDuration("0:0:2:0", 4, 4)).toBe(1); // two quavers == one beat
    expect(parseDuration("0:0:0:2", 4, 4)).toBe(0.5); // two semiquavers == one quaver
  });
});

describe("round-trips", () => {
  const sigs: Array<[number, number]> = [
    [4, 4],
    [3, 4],
    [6, 8],
    [7, 8],
  ];
  const beats = [0, 1, 2.5, 4, 7, 12.25, 0.0625];

  it("position: beats -> string -> beats is identity", () => {
    for (const [num, den] of sigs)
      for (const b of beats)
        expect(
          parsePosition(beatsToPosition(b, num, den), num, den),
        ).toBeCloseTo(b, 9);
  });

  it("duration: beats -> string -> beats is identity", () => {
    for (const [num, den] of sigs)
      for (const b of beats)
        expect(
          parseDuration(beatsToDuration(b, num, den), num, den),
        ).toBeCloseTo(b, 9);
  });
});

describe("bad input", () => {
  it("throws on a non-timecode string", () => {
    expect(() => parseDuration("a:b", 4, 4)).toThrow(/bad timecode/);
    expect(() => parsePosition("", 4, 4)).toThrow(/bad timecode/);
    // A dot is a TICK count, so it may appear once and must carry digits.
    expect(() => parsePosition("1:1.2.3", 4, 4)).toThrow(/bad timecode/);
    expect(() => parsePosition("1:1.", 4, 4)).toThrow(/bad timecode/);
    expect(() => parsePosition(".5", 4, 4)).toThrow(/bad timecode/);
  });

  it("reads `1.5` as a bar and five ticks, not as a number", () => {
    // It used to be refused. It is a legal timecode now, and that is the one thing this format
    // change costs: the notation overlaps a plain YAML float, which is why TIMECODE_KEYS are
    // written quoted and why the schema had to learn the dot at the same time as the parser.
    expect(parsePosition("1.5", 4, 4)).toBeCloseTo(5 / TICKS_PER_QUARTER, 9);
  });
});

// --- the tick form ------------------------------------------------------------
//
// The colon used to nest to arbitrary depth: each field past the beat divided the last by four, so
// an off-grid time came out as `3:2:2:4:2:3:1:3` — eight place values nobody can read, and no two
// of them the same size. The chain now stops at the SEMIQUAVER, halving as it goes, and whatever
// is left is written as ticks, at 960 to the quarter note.
//
// 4/4 throughout: a beat is one quarter, a quaver is 480 ticks, a semiquaver 240.

describe("ticks", () => {
  it("writes what is left below the semiquaver as a tick count", () => {
    // A dotted 16th: one whole semiquaver, then half of one. The half used to need a level deeper.
    expect(beatsToPosition(0.375, 4, 4)).toBe("1:1:1:2.120");
  });

  it("keeps the short form when a time lands on a whole field", () => {
    expect(beatsToPosition(0, 4, 4)).toBe("1:1");
    expect(beatsToPosition(4, 4, 4)).toBe("2:1");
    expect(beatsToPosition(0.5, 4, 4)).toBe("1:1:2"); // one quaver in
    expect(beatsToDuration(1, 4, 4)).toBe("0:1");
  });

  it("writes the quaver even at its origin when a semiquaver follows it", () => {
    // A level is only droppable when everything BELOW it is at the origin too: "1:1:2" already
    // means half a beat, so a semiquaver written without its quaver would say twice what it is.
    expect(beatsToPosition(0.25, 4, 4)).toBe("1:1:1:2");
    expect(beatsToPosition(0.75, 4, 4)).toBe("1:1:2:2");
  });

  it("carries a remainder that rounds up to a whole beat instead of overflowing a level", () => {
    // Real data: `"32:3:4:4:4:4:4:4"` in 01.danse.l8 is 126.999755 beats, and its sub-beat
    // remainder rounds to 960 ticks — a whole beat. Rounding the remainder on its own wrote
    // `"32:3:3"`: a quaver field holding TWO quavers. It played right and read wrong, and the old
    // ÷4 rule takes that spelling half a beat earlier.
    expect(beatsToPosition(126.999755859375, 4, 4)).toBe("32:4");
    // Every level stays inside its own range, whatever the input.
    for (const b of [0.9999, 3.9999, 126.999755859375, 0.4999, 0.2499]) {
      const f = beatsToPosition(b, 4, 4).split(".")[0].split(":").map(Number);
      expect(f[1]).toBeLessThanOrEqual(4); // a 4/4 bar has four crotchets
      if (f[2] !== undefined) expect(f[2]).toBeLessThanOrEqual(2); // two quavers to a crotchet
      if (f[3] !== undefined) expect(f[3]).toBeLessThanOrEqual(2); // two semiquavers to a quaver
    }
  });

  it("hangs the ticks off the beat when there is no whole sub", () => {
    // Absolute, so no zero sub is needed to disambiguate: 1/960 of a quarter is 1/960 of a quarter
    // wherever it is written.
    expect(beatsToPosition(10 / TICKS_PER_QUARTER, 4, 4)).toBe("1:1.10");
    // Half a sub is a 32nd, and there is still no whole sub to write.
    expect(beatsToPosition(0.125, 4, 4)).toBe("1:1.120");
  });

  it("round-trips every time it can write", () => {
    for (const beats of [0, 0.125, 0.25, 1, 1.5, 4, 7.33, 61.7]) {
      const tc = beatsToPosition(beats, 4, 4);
      // Within half a tick: the writer rounds to the grid, which is the resolution it claims.
      expect(parsePosition(tc, 4, 4)).toBeCloseTo(beats, 3);
    }
  });

  it("is exact on a triplet, which is why 960 and not 1024", () => {
    const third = 1 / 3;
    expect(parsePosition(beatsToPosition(third, 4, 4), 4, 4)).toBeCloseTo(
      third,
      6,
    );
  });

  it("still reads a DEEP chain by the old ÷4 rule — five fields or more cannot be the new one", () => {
    // Refusing these would make the songs on disk unreadable, and the length is what tells them
    // apart: the current notation never writes past the semiquaver.
    expect(parseDuration("0:0:0:0:0:1:3:2", 4, 4)).toBeGreaterThan(0);
    expect(parsePosition("1:1:1:1:3", 4, 4)).toBeCloseTo(
      parseLegacyPosition("1:1:1:1:3", 4, 4),
      9,
    );
  });

  /**
   * A SHORT chain is legal in both notations and does not always mean the same thing, and no syntax
   * separates them — which is why `migrateTimecodes` exists and why it reads with `legacy` on.
   *
   * It matters less than it sounds: every short deep chain in the repo's songs sits at its own
   * level's origin (`"1:1:1"`, `"2:1:1"`), and an origin is 0 under either rule. Three values in one
   * imported song were not, and they were rewritten.
   */
  it("reads a short chain by the NEW rule, which the old one disagrees with", () => {
    expect(parsePosition("1:1:3", 4, 4)).toBe(1); // two quavers
    expect(parseLegacyPosition("1:1:3", 4, 4)).toBe(0.5); // two semiquavers, as it used to
    // …and where it does agree, it agrees exactly: an origin is an origin.
    for (const tc of ["1:1:1", "2:1:1", "1:2:1", "3:1:1"])
      expect(parsePosition(tc, 4, 4)).toBe(parseLegacyPosition(tc, 4, 4));
  });

  it("counts ticks from zero in a position, as in a duration", () => {
    // They are a REMAINDER, not an index — the 1-based rule applies to fields, not to what is
    // left over after them.
    expect(parsePosition("1:1.0", 4, 4)).toBe(0);
    expect(parseDuration("0:0.0", 4, 4)).toBe(0);
  });
});
