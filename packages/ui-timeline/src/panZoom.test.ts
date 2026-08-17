// The bug this exists for: one fixed step served a wheel notch and a trackpad pinch. A notch is
// one event and a step is right; a pinch is dozens of events a second, so the same step slammed
// into the zoom limit before the fingers had finished moving — which is what "pinch does not
// work on the timeline" turned out to mean.

import { describe, expect, it } from "vitest";
import { MAX_LANE_PX, wheelFactor, zoomCeiling } from "./panZoom";

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

// The ceiling used to be a flat 32, which is a number and not a reason — and it is the one people
// MET: the wheel stopped, with nothing on screen to say why. It is derived now, from the only
// limit that is really there.
describe("how far a pane may zoom", () => {
  it("is what the browser can still lay out, not a constant", () => {
    // A laptop pane: thousands of times, which nobody reaches by turning a wheel.
    expect(zoomCeiling(1200)).toBeGreaterThan(10_000);
    // …and the lane it produces is inside the limit a browser will actually draw.
    expect(1200 * zoomCeiling(1200)).toBeLessThanOrEqual(MAX_LANE_PX);
  });

  it("gives a NARROW pane more of it, since the limit is the lane and not the zoom", () => {
    expect(zoomCeiling(400)).toBeGreaterThan(zoomCeiling(1200));
    expect(400 * zoomCeiling(400)).toBeCloseTo(1200 * zoomCeiling(1200), 0);
  });

  it("never answers less than fit, whatever it is handed", () => {
    expect(zoomCeiling(0)).toBeGreaterThanOrEqual(1);
    expect(zoomCeiling(-5)).toBeGreaterThanOrEqual(1);
    expect(zoomCeiling(Number.MAX_SAFE_INTEGER)).toBe(1);
  });
});
