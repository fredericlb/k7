// What this pins: a wheel notch and a trackpad pinch cannot share one fixed step. A notch is one
// event and a step is right; a pinch is dozens of events a second, so the same step slams into
// the zoom limit before the fingers have finished moving — which is what "pinch does not work on
// the timeline" means.

import { describe, expect, it } from "vitest";
import {
  isMouseWheel,
  isZoomWheel,
  MAX_LANE_PX,
  wheelFactor,
  wheelZooms,
  zoomCeiling,
} from "./panZoom";

describe("one wheel event on an arrangement", () => {
  it("takes a whole step per notch, whatever the delta says", () => {
    // A detent is a discrete decision; its delta's size is a browser detail nobody should read.
    expect(wheelFactor(-100, false)).toBeCloseTo(1.15, 5);
    expect(wheelFactor(-3, false)).toBeCloseTo(1.15, 5);
    expect(wheelFactor(100, false)).toBeCloseTo(1 / 1.15, 5);
  });

  it("tracks the FINGERS on a pinch instead of stepping", () => {
    // A pinch frame's delta is small and continuous: at the notch's 15% step, a second is hundreds.
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

describe("isZoomWheel", () => {
  it("calls a PINCH a zoom — that is how a trackpad sends one", () => {
    // The browser synthesises ctrlKey for a pinch, and it is the only signal there is.
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it("calls a plain wheel a PAN, which is the whole change", () => {
    // Two fingers sliding arrive exactly like a mouse wheel, so the plain wheel gives up zoom.
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

/** Which DEVICE turned the wheel, which decides whether the pane zooms or scrolls — docs/panZoom.md. */
describe("telling a wheel from a surface", () => {
  const ev = (o: Partial<Parameters<typeof isMouseWheel>[0]>) => ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...o,
  });

  it("reads lines or pages as a wheel — nothing else reports those", () => {
    expect(isMouseWheel(ev({ deltaY: 3, deltaMode: 1 }))).toBe(true);
    expect(isMouseWheel(ev({ deltaY: 1, deltaMode: 2 }))).toBe(true);
  });

  it("separates a MOUSE from a TRACKPAD by the legacy 120s", () => {
    // A detent is a multiple of 120; a trackpad reports 3× its pixel delta and lands there by accident.
    expect(isMouseWheel(ev({ deltaY: 100, wheelDeltaY: -120 }))).toBe(true);
    expect(isMouseWheel(ev({ deltaY: 4, wheelDeltaY: -12 }))).toBe(false);
    expect(isMouseWheel(ev({ deltaY: 1.5, wheelDeltaY: -4.5 }))).toBe(false);
  });

  it("falls back on the delta's SHAPE where the legacy field is absent", () => {
    // Firefox in pixel mode. A notch is integral, vertical only, and large.
    expect(isMouseWheel(ev({ deltaY: 120 }))).toBe(true);
    expect(isMouseWheel(ev({ deltaY: 6 }))).toBe(false); // too small: a finger
    expect(isMouseWheel(ev({ deltaY: 60.5 }))).toBe(false); // fractional: a finger
    expect(isMouseWheel(ev({ deltaY: 100, deltaX: 8 }))).toBe(false); // sideways: a surface
  });

  it("errs towards the SURFACE, which is the only safe direction", () => {
    // A trackpad that zooms is broken; a mouse that pans merely does not zoom yet.
    expect(isMouseWheel(ev({}))).toBe(false);
  });
});

/** …and the whole rule, which the hook cannot be asked for, being an effect on a DOM node. */
describe("what one wheel event over an arrangement means", () => {
  const ev = (o: Partial<Parameters<typeof wheelZooms>[0]>) => ({
    ctrlKey: false,
    metaKey: false,
    ...o,
  });

  it("scrolls on a bare wheel, mouse or trackpad — the browser's own scroll walks the lanes", () => {
    expect(wheelZooms(ev({}))).toBe(false);
  });

  it("zooms on a pinch, or on Cmd/Ctrl with either device", () => {
    expect(wheelZooms(ev({ ctrlKey: true }))).toBe(true);
    expect(wheelZooms(ev({ metaKey: true }))).toBe(true);
  });
});

// The ceiling is DERIVED rather than a flat 32, which would be a number and not a reason — see docs/panZoom.md.
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
