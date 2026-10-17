// The series palette: what "the third take is teal" relies on, in every view that draws a series.

import { describe, expect, it } from "vitest";
import { SERIES_COLORS, seriesColor } from "./seriesColors";

describe("seriesColor", () => {
  it("visits all twelve hues before repeating", () => {
    const first = Array.from({ length: 12 }, (_, i) => seriesColor(i));
    expect(new Set(first).size).toBe(12);
    expect(seriesColor(12)).toBe(seriesColor(0));
  });

  it("puts neighbours far apart on the wheel, never on adjacent hues", () => {
    for (let i = 0; i < 12; i++) {
      const a = SERIES_COLORS.indexOf(seriesColor(i) as never);
      const b = SERIES_COLORS.indexOf(seriesColor(i + 1) as never);
      const steps = Math.min((a - b + 12) % 12, (b - a + 12) % 12);
      expect(steps).toBeGreaterThanOrEqual(5);
    }
  });

  it("keeps the amber hue out of the first eight, which a deck's cue buttons use", () => {
    const amber = SERIES_COLORS[2];
    for (let i = 0; i < 8; i++) expect(seriesColor(i)).not.toBe(amber);
  });

  it("answers a negative index rather than undefined", () => {
    expect(SERIES_COLORS).toContain(seriesColor(-1));
  });
});
