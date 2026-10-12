import { describe, expect, it } from "vitest";
import { getChordPositions } from "./chordDiagram";

describe("getChordPositions", () => {
  it("resolves common chords to at least one fingering", () => {
    for (const c of ["C", "Am", "Cmaj7", "Bb", "C#m7", "G7", "Dsus4"]) {
      const positions = getChordPositions(c);
      expect(positions, c).toBeTruthy();
      expect(positions!.length, c).toBeGreaterThan(0);
      // Each position covers all six guitar strings.
      expect(positions![0].frets.length, c).toBe(6);
    }
  });

  it("exposes alternative fingerings (multiple positions)", () => {
    // Open C major has several documented shapes in chords-db.
    expect(getChordPositions("C")!.length).toBeGreaterThan(1);
  });

  it("falls back to the bare triad for a slash chord it lacks", () => {
    // Whether or not "G/B" has a dedicated shape, we always get a usable G shape.
    expect(getChordPositions("G/B")).toBeTruthy();
  });

  it("returns null for non-chords", () => {
    expect(getChordPositions("Hello")).toBeNull();
    expect(getChordPositions("N.C.")).toBeNull();
  });
});
