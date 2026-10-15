import { describe, expect, it } from "vitest";
import { peakOf, TapHistory } from "./lcdScreen";

describe("TapHistory", () => {
  it("folds each point to its peak and keeps only the newest", () => {
    const h = new TapHistory(3);
    h.push([
      { min: -0.5, max: 0.2 },
      { min: -0.1, max: 0.3 },
    ]);
    h.push([
      { min: 0, max: 0.9 },
      { min: -0.7, max: 0.1 },
    ]);
    expect(h.points).toEqual([0.3, 0.9, 0.7]);
  });

  it("peakOf is the larger swing either side of zero", () => {
    expect(peakOf({ min: -0.8, max: 0.1 })).toBe(0.8);
  });
});
