// The bug this exists for: one fixed step served a wheel notch and a trackpad pinch. A notch is
// one event and a step is right; a pinch is dozens of events a second, so the same step slammed
// into the zoom limit before the fingers had finished moving — which is what "pinch does not
// work on the timeline" turned out to mean.

import { describe, expect, it } from "vitest";
import {
  isMouseWheel,
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

/**
 * Which DEVICE turned the wheel, which is what decides whether an arrangement zooms or scrolls.
 *
 * A mouse wheel zooms these panes — a detent is a discrete decision, and zooming is the natural
 * thing for it to do over a timeline. A trackpad slide still pans, because it is the only way a
 * trackpad can say "scroll" and zooming there made every attempt to pan zoom instead. Same three
 * signals the graph reads (`@studio/ui-chains-react`'s `camera.ts`), pinned on both sides so the
 * two copies cannot drift.
 */
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
    // Chrome and Safari still carry wheelDeltaY: a detent is a multiple of 120, where a trackpad
    // reports three times its pixel delta and lands there only by accident.
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
    // A trackpad that zooms when you meant to pan is a broken trackpad; a mouse that pans is
    // merely a mouse that does not zoom yet. So an unrecognised device keeps the old behaviour.
    expect(isMouseWheel(ev({}))).toBe(false);
  });
});

/**
 * …and the whole rule the pane applies, which the hook cannot be asked for: it is an effect on a
 * DOM node and nothing in this repo mounts one, so written inline it could only be checked by hand.
 */
describe("what one wheel event over an arrangement means", () => {
  const ev = (o: Partial<Parameters<typeof wheelZooms>[0]>) => ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...o,
  });
  const NOTCH = { deltaY: 100, wheelDeltaY: -120 };
  const SLIDE = { deltaY: 4, wheelDeltaY: -12 };

  it("zooms on a mouse notch — the whole point of this change", () => {
    expect(wheelZooms(ev(NOTCH))).toBe(true);
  });

  it("leaves a trackpad SLIDE to the browser, which is what pans it", () => {
    expect(wheelZooms(ev(SLIDE))).toBe(false);
  });

  it("zooms on a pinch, on either device", () => {
    expect(wheelZooms(ev({ ...SLIDE, ctrlKey: true }))).toBe(true);
    expect(wheelZooms(ev({ ...NOTCH, metaKey: true }))).toBe(true);
  });

  it("gives SHIFT back to the browser, so a mouse keeps a scroll gesture", () => {
    // Every browser reads Shift+wheel as "sideways", and after this change it is the only scroll
    // a mouse has left on this pane.
    expect(wheelZooms(ev({ ...NOTCH, shiftKey: true }))).toBe(false);
  });

  it("still calls Ctrl+Shift+wheel a pinch — a finger resting on Shift is not an instruction", () => {
    expect(wheelZooms(ev({ ...SLIDE, ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
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
