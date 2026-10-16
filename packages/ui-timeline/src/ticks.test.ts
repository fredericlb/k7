import { describe, expect, it } from "vitest";
import {
  adjacentTick,
  chooseTick,
  formatClock,
  formatSecondTick,
  nearestTick,
  SECOND_TICKS,
  secondTicks,
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
