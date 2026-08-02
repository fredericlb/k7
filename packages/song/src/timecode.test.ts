import { describe, expect, it } from "vitest";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "./timecode";

// The model measures time in beats = quarter notes. A metrical beat is 4/den
// quarter notes; a bar is num such beats. Positions are 1-based ("1:1:1" == start),
// durations 0-based ("1:0:0" == one bar).

describe("parsePosition", () => {
  it("reads a 1-based bar:beat:sub in 4/4 (den 4 => a beat is one quarter)", () => {
    expect(parsePosition("1:1:1", 4, 4)).toBe(0); // the very start
    expect(parsePosition("2:1:1", 4, 4)).toBe(4); // top of bar 2 = 4 beats
    expect(parsePosition("1:2:1", 4, 4)).toBe(1); // 2nd beat of bar 1
    expect(parsePosition("1:1:2", 4, 4)).toBe(0.25); // 2nd sub = a 16th
  });

  it("scales the beat by the denominator (6/8 => a beat is an eighth)", () => {
    // den 8 => q = 0.5 quarter notes per beat; a 6/8 bar = 3 quarter notes.
    expect(parsePosition("2:1:1", 6, 8)).toBe(3);
    expect(parsePosition("1:2:1", 6, 8)).toBe(0.5);
  });
});

describe("parseDuration", () => {
  it("counts 0-based in the same units", () => {
    expect(parseDuration("0:0:0", 4, 4)).toBe(0);
    expect(parseDuration("1:0:0", 4, 4)).toBe(4); // one bar
    expect(parseDuration("0:1:0", 4, 4)).toBe(1); // one beat
    expect(parseDuration("0:0:4", 4, 4)).toBe(1); // four 16ths == one beat
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
    expect(() => parsePosition("1.5", 4, 4)).toThrow(/bad timecode/);
    expect(() => parseDuration("a:b", 4, 4)).toThrow(/bad timecode/);
  });
});
