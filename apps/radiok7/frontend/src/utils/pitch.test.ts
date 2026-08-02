import { describe, expect, it } from "vitest";
import { freqToNote, nearestString } from "./pitch";

describe("freqToNote", () => {
  it("maps concert A to A4 with zero cents", () => {
    const n = freqToNote(440);
    expect(n.name).toBe("A");
    expect(n.octave).toBe(4);
    expect(n.cents).toBe(0);
  });

  it("maps middle C (~261.63 Hz) to C4", () => {
    const n = freqToNote(261.63);
    expect(n.name).toBe("C");
    expect(n.octave).toBe(4);
    expect(Math.abs(n.cents)).toBeLessThanOrEqual(1);
  });

  it("reports a slightly sharp note as positive cents", () => {
    const n = freqToNote(445); // ~+20 cents above A4
    expect(n.name).toBe("A");
    expect(n.cents).toBeGreaterThan(0);
  });
});

describe("nearestString", () => {
  it("snaps each open-string frequency to its own string", () => {
    expect(nearestString(82).label).toBe("E2");
    expect(nearestString(110).label).toBe("A2");
    expect(nearestString(147).label).toBe("D3");
    expect(nearestString(196).label).toBe("G3");
    expect(nearestString(247).label).toBe("B3");
    expect(nearestString(330).label).toBe("E4");
  });

  it("picks the closest string for an out-of-tune pluck", () => {
    expect(nearestString(105).label).toBe("A2"); // flat A
  });
});
