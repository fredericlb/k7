// The ruler's two decisions: which unit it draws, and which of those columns get a number.
// The numbering half is what these mostly pin — a label has to be given room for the digits
// it actually has, or a ruler that reads fine at bar 7 smears at bar 129 (docs/ticks.md).

import { describe, expect, it } from "vitest";
import {
  LABEL_GAP_PX,
  labelled,
  labelMinPx,
  labelStride,
  MIN_LABEL_PX,
  MONO_CHAR_PX,
  nearestTick,
  subdivideBeats,
} from "./ticks";

describe("labelMinPx", () => {
  it("asks for the label's own width plus a gap", () => {
    expect(labelMinPx("129")).toBeCloseTo(3 * MONO_CHAR_PX + LABEL_GAP_PX);
    expect(labelMinPx("12.4")).toBeCloseTo(4 * MONO_CHAR_PX + LABEL_GAP_PX);
  });

  it("grows with the digits — the whole point", () => {
    // The bug this replaced: one flat minimum, sized for "7", applied to "129" as well.
    expect(labelMinPx("129")).toBeGreaterThan(labelMinPx("7"));
    expect(labelMinPx("129.4")).toBeGreaterThan(labelMinPx("129"));
  });

  it("never drops below the floor, whatever it is handed", () => {
    expect(labelMinPx("")).toBe(MIN_LABEL_PX);
  });
});

describe("labelStride", () => {
  it("thins by powers of two, so the survivors stay round", () => {
    // Bars 20px apart, labels needing ~30: every 2nd bar — 1, 3, 5… not 1, 4, 7.
    expect(labelStride(20, 30)).toBe(2);
    expect(labelStride(20, 70)).toBe(4);
    expect(labelStride(20, 130)).toBe(8);
  });

  it("leaves every line labelled once they fit", () => {
    expect(labelStride(40, 30)).toBe(1);
  });

  it("gives a wide label more room than a narrow one at the same zoom", () => {
    // 16px between bars: "7" fits, "129" is twice as wide and does not. Under the old flat
    // 10px minimum both were labelled here, which is precisely how the numbers overlapped.
    const spacing = 16;
    expect(labelStride(spacing, labelMinPx("7"))).toBe(1);
    expect(labelStride(spacing, labelMinPx("129"))).toBeGreaterThan(1);
  });

  it("thins until the labels genuinely clear each other", () => {
    for (const label of ["7", "42", "129", "1024", "129.4"])
      for (const spacing of [3, 8, 12, 16, 24, 40]) {
        const stride = labelStride(spacing, labelMinPx(label));
        expect(spacing * stride).toBeGreaterThanOrEqual(labelMinPx(label));
      }
  });

  it("yields 1 rather than dividing by nothing on a degenerate zoom", () => {
    expect(labelStride(0)).toBe(1);
    expect(labelStride(Number.NaN)).toBe(1);
    expect(labelStride(-5)).toBe(1);
  });
});

describe("labelled", () => {
  it("counts from the ORIGIN, so panning doesn't re-pick the survivors", () => {
    expect(labelled(0, 4)).toBe(true);
    expect(labelled(4, 4)).toBe(true);
    expect(labelled(5, 4)).toBe(false);
    expect(labelled(7, 1)).toBe(true); // stride 1 labels everything
  });
});

describe("subdivideBeats", () => {
  it("draws bars while a bar fits", () => {
    expect(subdivideBeats(4, 10)).toBe(4); // a 4/4 bar at 40px
  });

  it("descends to the BEAT, not to half a bar", () => {
    // 4/4 at 20px per beat: the bar is 80px, too wide — the next rung is the quarter.
    expect(subdivideBeats(4, 20)).toBe(1);
  });

  it("halves only below the beat", () => {
    expect(subdivideBeats(4, 60)).toBe(0.5);
    expect(subdivideBeats(4, 200)).toBeCloseTo(0.25);
  });

  it("floors rather than spinning on a degenerate zoom", () => {
    expect(subdivideBeats(4, 0)).toBe(4);
    expect(subdivideBeats(4, Number.NaN)).toBe(4);
    expect(subdivideBeats(4, 1e9)).toBeGreaterThanOrEqual(1 / 64);
  });
});

describe("nearestTick", () => {
  // What a ruler click lands on. The list is the one the ruler DREW, so a click can only
  // ever put the playhead on a line that is on screen.
  const ticks = [0, 0.5, 1, 1.5, 2];

  it("takes the closest line, either side", () => {
    expect(nearestTick(ticks, 1.1)).toBe(1);
    expect(nearestTick(ticks, 1.4)).toBe(1.5);
  });

  it("keeps a value already on a tick", () => {
    expect(nearestTick(ticks, 1.5)).toBe(1.5);
  });

  it("clamps to the ends rather than extending the grid", () => {
    // There is no tick at -1 or at 9: a click past the last line lands ON the last line.
    expect(nearestTick(ticks, -1)).toBe(0);
    expect(nearestTick(ticks, 9)).toBe(2);
  });

  it("takes the first of two equally close lines, not an average", () => {
    expect(nearestTick(ticks, 0.25)).toBe(0);
  });

  it("returns null when the ruler drew nothing", () => {
    // The caller then seeks exactly where the pointer was — a waveform with no musical
    // grid (k7's) must not be snapped to anything.
    expect(nearestTick([], 1.2)).toBe(null);
  });

  it("does not need the list sorted", () => {
    expect(nearestTick([2, 0, 1], 0.9)).toBe(1);
  });
});
