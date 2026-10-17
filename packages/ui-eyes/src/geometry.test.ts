import { describe, expect, it } from "vitest";
import { containUV, isFullFrame, laneUV } from "./geometry";

describe("containUV", () => {
  it("leaves a picture of the frame's shape alone", () => {
    expect(containUV(16 / 9, 16 / 9)).toEqual([1, 1, 0, 0]);
  });

  it("puts a portrait picture between bars in a landscape frame, sampling past its edges", () => {
    const [sx, sy, ox, oy] = containUV(9 / 16, 16 / 9);
    expect(sy).toBe(1);
    expect(oy).toBe(0);
    // The quad spans more than the picture: what falls outside [0,1] is the bars.
    expect(sx).toBeCloseTo(256 / 81);
    expect(ox).toBeCloseTo((1 - 256 / 81) / 2);
  });
});

describe("which lanes contain", () => {
  it("is a lane covering the whole frame, and not a boxed one", () => {
    expect(isFullFrame({ x: 0, y: 0, w: 1280, h: 720 }, 1280, 720)).toBe(true);
    expect(isFullFrame({ x: 40, y: 40, w: 320, h: 180 }, 1280, 720)).toBe(
      false,
    );
  });

  it("contains a full-frame lane and covers a boxed one", () => {
    expect(laneUV(9 / 16, 16 / 9, true)[0]).toBeGreaterThan(1);
    expect(laneUV(9 / 16, 16 / 9, false)[1]).toBeLessThan(1);
  });
});
