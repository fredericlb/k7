// Which way a drag runs the record, and how fast. The SIGN is the half that would be wrong in a
// way nobody could argue with — the band slides under a fixed head, so left is forward.
// See ../docs/waveform.md.

import { describe, expect, it } from "vitest";
import { SHUTTLE_DEAD, SHUTTLE_MAX, shuttleRate } from "./shuttle";

const W = 400;

describe("which way it runs", () => {
  it("goes FORWARD when the hand goes left", () => {
    // The song slides left under the playhead, so pulling left pulls what is coming towards you.
    expect(shuttleRate(-100, W)).toBeGreaterThan(0);
  });

  it("rewinds when the hand goes right", () => {
    expect(shuttleRate(100, W)).toBeLessThan(0);
  });

  it("runs the same speed either way", () => {
    expect(shuttleRate(-137, W)).toBeCloseTo(-shuttleRate(137, W));
  });
});

describe("how fast", () => {
  it("stands still inside the dead zone, so a click does not move the record", () => {
    expect(shuttleRate(0, W)).toBe(0);
    expect(shuttleRate(SHUTTLE_DEAD, W)).toBe(0);
    expect(shuttleRate(-SHUTTLE_DEAD, W)).toBe(0);
    expect(shuttleRate(SHUTTLE_DEAD + 1, W)).not.toBe(0);
  });

  it("gets faster the further it is pulled, all the way out", () => {
    let last = 0;
    for (let dx = SHUTTLE_DEAD + 1; dx <= W; dx += 3) {
      const now = -shuttleRate(dx, W);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it("reaches full speed at HALF the band, and never passes it", () => {
    // Half is the distance from the playhead to the edge: pulling the visible future under the head.
    expect(shuttleRate(-W / 2, W)).toBeCloseTo(SHUTTLE_MAX);
    expect(shuttleRate(-W, W)).toBeCloseTo(SHUTTLE_MAX);
    expect(shuttleRate(-W * 10, W)).toBeCloseTo(SHUTTLE_MAX);
  });

  it("keeps the middle of the throw slow — which is what a straight line could not", () => {
    // A third of the way out is a NINTH of the speed: the nudge and the run are one gesture.
    const third = SHUTTLE_DEAD + (W / 2 - SHUTTLE_DEAD) / 3;
    expect(shuttleRate(-third, W)).toBeCloseTo(SHUTTLE_MAX / 9);
    expect(shuttleRate(-third, W)).toBeLessThan(SHUTTLE_MAX / 3);
  });

  it("says nothing about a band with no width", () => {
    expect(shuttleRate(-50, 0)).toBe(0);
    expect(shuttleRate(-50, SHUTTLE_DEAD)).toBe(0);
  });
});
