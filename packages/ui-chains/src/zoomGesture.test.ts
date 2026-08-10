// The bug this exists for: one coefficient served a wheel notch and a trackpad pinch, and the
// pinch — dozens of small deltas a second — moved a fraction of a percent each. Zooming with two
// fingers took an arm's length of trackpad.

import { describe, expect, it } from "vitest";
import { pinchFactor, spreadOf, wheelZoomFactor } from "./zoomGesture";

describe("one wheel event", () => {
  it("moves a notch about a tenth, which is what it always did", () => {
    // A detent reports ~100. Unchanged by this fix, deliberately: nobody complained about it.
    expect(wheelZoomFactor(-100, false)).toBeCloseTo(1.105, 2);
    expect(wheelZoomFactor(100, false)).toBeCloseTo(0.905, 2);
  });

  it("moves a PINCH ten times as far for the same delta", () => {
    // The whole fix, in one line: a pinch reports units, not hundreds.
    expect(wheelZoomFactor(-5, true) - 1).toBeGreaterThan(
      (wheelZoomFactor(-5, false) - 1) * 9,
    );
  });

  it("makes a pinch felt at the size a trackpad actually reports", () => {
    // ~4% for a five-unit delta: perceptible per event, and smooth at sixty a second.
    expect(wheelZoomFactor(-5, true)).toBeCloseTo(1.051, 2);
    // Where it was: a quarter of one percent, which is the complaint.
    expect(wheelZoomFactor(-5, false)).toBeCloseTo(1.005, 2);
  });

  it("zooms IN when the fingers spread and OUT when they close", () => {
    expect(wheelZoomFactor(-5, true)).toBeGreaterThan(1);
    expect(wheelZoomFactor(5, true)).toBeLessThan(1);
  });

  it("cannot jump a decade on a browser that reports a pinch in hundreds", () => {
    // Clamped, so the units a browser chooses cannot turn one event into a teleport.
    expect(wheelZoomFactor(-5000, true)).toBeLessThan(1.7);
    expect(wheelZoomFactor(5000, true)).toBeGreaterThan(0.6);
  });

  it("does nothing at all for a delta of nothing", () => {
    expect(wheelZoomFactor(0, true)).toBe(1);
    expect(wheelZoomFactor(0, false)).toBe(1);
  });
});

describe("two fingers", () => {
  it("scales by how much further apart they are than when they landed", () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(200, 100)).toBe(0.5);
  });

  it("returns EXACTLY where it began, which frame-to-frame ratios would not", () => {
    // Out and back: measured from the start, the round trip is the identity.
    const start = 120;
    for (const d of [200, 340, 90, 120]) {
      /* wandering */
      expect(pinchFactor(start, d)).toBeCloseTo(d / start, 10);
    }
    expect(pinchFactor(start, start)).toBe(1);
  });

  it("is not a gesture when the fingers are in the same place", () => {
    expect(pinchFactor(0, 100)).toBe(1);
    expect(pinchFactor(100, 0)).toBe(1);
  });

  it("measures the spread as the distance between the two touches", () => {
    expect(
      spreadOf({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }),
    ).toBe(5);
  });
});
