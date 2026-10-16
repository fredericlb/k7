import { describe, expect, it } from "vitest";
import {
  adjacentTick,
  chooseTick,
  formatClock,
  formatSecondTick,
  LABEL_GAP_PX,
  labelled,
  labelMinPx,
  labelStride,
  MAX_GRID_SPLIT,
  MIN_LABEL_PX,
  MONO_CHAR_PX,
  nearestTick,
  SECOND_TICKS,
  secondTicks,
  subdivideBeats,
  subdivideGrid,
  ticksUpTo,
} from "./ticks";

describe("chooseTick", () => {
  it("takes the COARSEST step that still clears minPx", () => {
    // 10 px/s: a 5s step is 50px (too tight at 56), a 10s step is 100px.
    expect(chooseTick(SECOND_TICKS, 10)).toBe(10);
    // 200 px/s: a 0.5s step is already 100px, and 0.2s is only 40.
    expect(chooseTick(SECOND_TICKS, 200)).toBe(0.5);
  });

  it("falls back to the finest rather than failing when even it is too wide", () => {
    expect(chooseTick(SECOND_TICKS, 0.0001)).toBe(3600);
  });
});

describe("ticksUpTo", () => {
  it("counts rather than accumulates, so a 0.1 step stays on the grid", () => {
    const t = ticksUpTo(40, 0.1);
    expect(t[t.length - 1]).toBe(40); // 40.000000000000255 if this ever accumulates
    expect(t).toHaveLength(401);
  });

  it("is empty for a step that cannot make progress", () => {
    expect(ticksUpTo(10, 0)).toEqual([]);
  });
});

describe("formatClock", () => {
  it("shows only the decimals the STEP needs", () => {
    expect(formatClock(90, 30)).toBe("1:30");
    expect(formatClock(90.5, 0.5)).toBe("1:30.5");
    expect(formatClock(90.25, 0.04)).toBe("1:30.25");
    expect(formatClock(5, 1)).toBe("0:05");
  });

  it("carries a rounded-up second into the minute", () => {
    expect(formatClock(59.7)).toBe("1:00");
    expect(formatClock(59.97, 0.5)).toBe("1:00.0");
    expect(formatClock(-59.7)).toBe("-1:00");
  });
});

describe("nearestTick", () => {
  it("returns null when nothing is within tolerance — a click on no tick is not a click on tick 0", () => {
    expect(nearestTick([0, 10, 20], 12, 1)).toBeNull();
    expect(nearestTick([0, 10, 20], 12, 3)).toBe(10);
  });
});

describe("secondTicks with a picture", () => {
  it("counts FRAMES below a second, so every fine tick is one", () => {
    const ladder = secondTicks(30);
    expect(ladder.slice(0, 5)).toEqual([
      1 / 30,
      2 / 30,
      5 / 30,
      10 / 30,
      15 / 30,
    ]);
    expect(ladder.slice(5, 7)).toEqual([1, 2]);
    // Every tick of the finest rung sits on a frame, which a 0.04s rung at 30 fps does not.
    for (const t of ticksUpTo(2, ladder[0] as number))
      expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-9);
  });

  it("keeps the decimal ladder for a song with no picture", () => {
    expect(secondTicks()).toBe(SECOND_TICKS);
    expect(secondTicks(0)).toBe(SECOND_TICKS);
  });

  it("labels a frame tick by its frame, and a whole second as a clock", () => {
    expect(formatSecondTick(1 + 12 / 30, 1 / 30, 30)).toBe("12f");
    expect(formatSecondTick(2, 1 / 30, 30)).toBe("0:02");
    expect(formatSecondTick(0.5, 0.5)).toBe(formatClock(0.5, 0.5));
  });
});

describe("adjacentTick", () => {
  it("steps off the tick it is on, either way, and stops at the ends", () => {
    const t = [0, 1, 2, 3];
    expect(adjacentTick(t, 1, 1)).toBe(2);
    expect(adjacentTick(t, 1, -1)).toBe(0);
    expect(adjacentTick(t, 1.4, 1)).toBe(2);
    expect(adjacentTick(t, 1.4, -1)).toBe(1);
    expect(adjacentTick(t, 3, 1)).toBeNull();
    expect(adjacentTick(t, 0, -1)).toBeNull();
  });
});

// The numbering half: a label has to be given room for the digits it actually has (docs/ticks.md).
describe("labelMinPx", () => {
  it("asks for the label's own width plus a gap", () => {
    expect(labelMinPx("129")).toBeCloseTo(3 * MONO_CHAR_PX + LABEL_GAP_PX);
    expect(labelMinPx("12.4")).toBeCloseTo(4 * MONO_CHAR_PX + LABEL_GAP_PX);
  });

  it("grows with the digits — the whole point", () => {
    // One flat minimum sized for "7" applies to "129" as well, and that is what this rules out.
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
    // 16px between bars: "7" fits, "129" is twice as wide and does not — a flat 10px would label both.
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

describe("subdivideGrid", () => {
  // The other half of the same rule, for the ruler that is HANDED its ticks and can only split what it has.
  it("adds nothing while the columns still fit", () => {
    // 1s apart at 40px/s — under the 50px threshold, so the beats stand on their own.
    expect(subdivideGrid([0, 1, 2], 40)).toEqual([]);
  });

  it("halves a column that has opened up", () => {
    // 1s apart at 80px/s: 80px is too wide, 40px is not — one line in the middle of each.
    expect(subdivideGrid([0, 1, 2], 80)).toEqual([0.5, 1.5]);
  });

  it("keeps halving as the zoom opens", () => {
    // 1s at 200px/s: 200 → 100 → 50, and 50 is not > 50, so quarters.
    expect(subdivideGrid([0, 1], 200)).toEqual([0.25, 0.5, 0.75]);
  });

  it("splits each PAIR on its own — a warped clip's beats are not evenly spaced", () => {
    // The first second is compressed on screen (40px, left alone), the next is stretched.
    expect(subdivideGrid([0, 1, 3], 40)).toEqual([2]);
  });

  it("floors rather than spinning, and refuses a degenerate scale", () => {
    expect(subdivideGrid([0, 1], 0)).toEqual([]);
    expect(subdivideGrid([0, 1], Number.NaN)).toEqual([]);
    expect(subdivideGrid([0, 1], 1e9)).toHaveLength(MAX_GRID_SPLIT - 1);
  });

  it("has nothing to split with fewer than two lines", () => {
    expect(subdivideGrid([], 100)).toEqual([]);
    expect(subdivideGrid([4], 100)).toEqual([]);
  });
});

describe("nearestTick, with no tolerance", () => {
  // What a ruler click lands on: the list is the one the ruler DREW, so you can only land on a visible line.
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
    // The caller then seeks exactly where the pointer was, since k7's grid-less waveform must not be snapped.
    expect(nearestTick([], 1.2)).toBe(null);
  });

  it("does not need the list sorted", () => {
    expect(nearestTick([2, 0, 1], 0.9)).toBe(1);
  });
});
