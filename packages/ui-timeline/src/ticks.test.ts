import { describe, expect, it } from "vitest";
import {
  chooseTick,
  formatClock,
  nearestTick,
  SECOND_TICKS,
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
});

describe("nearestTick", () => {
  it("returns null when nothing is within tolerance — a click on no tick is not a click on tick 0", () => {
    expect(nearestTick([0, 10, 20], 12, 1)).toBeNull();
    expect(nearestTick([0, 10, 20], 12, 3)).toBe(10);
  });
});
