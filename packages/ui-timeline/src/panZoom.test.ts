// The bug this exists for: one fixed step served a wheel notch and a trackpad pinch. A notch is
// one event and a step is right; a pinch is dozens of events a second, so the same step slammed
// into the zoom limit before the fingers had finished moving — which is what "pinch does not
// work on the timeline" turned out to mean.

import { describe, expect, it } from "vitest";
import { wheelFactor } from "./panZoom";

describe("one wheel event on an arrangement", () => {
  it("takes a whole step per notch, whatever the delta says", () => {
    // A detent is a discrete decision; its delta's size is a browser detail nobody should read.
    expect(wheelFactor(-100, false)).toBeCloseTo(1.15, 5);
    expect(wheelFactor(-3, false)).toBeCloseTo(1.15, 5);
    expect(wheelFactor(100, false)).toBeCloseTo(1 / 1.15, 5);
  });

  it("tracks the FINGERS on a pinch instead of stepping", () => {
    // The delta a trackpad reports for one frame of a pinch is small and continuous. Given the
    // notch's 15% step, a second of that was several hundred percent.
    expect(wheelFactor(-2, true)).toBeLessThan(wheelFactor(-2, false));
    expect(wheelFactor(-2, true)).toBeCloseTo(1.02, 2);
  });

  it("is proportional, so a bigger move zooms further", () => {
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-5, true));
    // …which the notch is deliberately not.
    expect(wheelFactor(-10, false)).toBe(wheelFactor(-5, false));
  });

  it("zooms in on a spread and out on a close", () => {
    expect(wheelFactor(-5, true)).toBeGreaterThan(1);
    expect(wheelFactor(5, true)).toBeLessThan(1);
  });

  it("cannot jump a decade on a browser that reports a pinch in hundreds", () => {
    expect(wheelFactor(-5000, true)).toBeLessThan(1.7);
    expect(wheelFactor(5000, true)).toBeGreaterThan(0.6);
  });

  it("does nothing at all for a delta of nothing", () => {
    expect(wheelFactor(0, true)).toBe(1);
  });
});
