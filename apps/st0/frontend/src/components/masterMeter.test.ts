// The master meter's two pure decisions: where the bar sits, and when the clip light clears.
//
// Only the arithmetic and the latch RULE are here — nothing mounts a component in this app (see
// AGENTS.md). What that leaves testable is the part that would be wrong silently: a scale that
// reads the floor as full, and a light that clears on the wrong event.

import { describe, expect, it } from "vitest";
import { clipLatch, FLOOR_DB, meterFill } from "./MasterMeter";

describe("the bar", () => {
  it("is empty at the floor and full at 0 dB", () => {
    expect(meterFill(FLOOR_DB)).toBe(0);
    expect(meterFill(0)).toBe(1);
  });

  it("is linear in dB, which is what a meter's markings are", () => {
    // Half the scale is half the dB, not half the amplitude — the whole reason a meter is drawn
    // in dB is that equal distances are equal loudness.
    expect(meterFill(FLOOR_DB / 2)).toBeCloseTo(0.5, 6);
  });

  it("clamps rather than running off either end", () => {
    // -100 is what the engine sends for "silent", and for "there is no meter to ask" — neither is
    // a negative width. Above 0 dB there is no more bar, only the light.
    expect(meterFill(-100)).toBe(0);
    expect(meterFill(6)).toBe(1);
  });
});

describe("the clip light", () => {
  // `clipLatch(lit, overloadNow, playing, wasPlaying)` → whether it is lit after this frame.
  it("lights on an overload and STAYS lit after the transport stops", () => {
    // The whole point: the engine reports the overload for the one 50 ms window it fell in, and
    // you are looking at the light afterwards. A light that told the truth only during the frame
    // it happened on would be a light nobody ever sees.
    expect(clipLatch(false, true, true, true)).toBe(true);
    expect(clipLatch(true, false, true, true)).toBe(true);
    expect(clipLatch(true, false, false, true)).toBe(true); // …and through the stop
    expect(clipLatch(true, false, false, false)).toBe(true); // …and while stopped
  });

  it("clears when a NEW pass starts, and only then", () => {
    // The rising edge of `playing` is the one thing that makes the last pass's verdict stale.
    expect(clipLatch(true, false, true, false)).toBe(false);
    // Still rolling is not a new pass.
    expect(clipLatch(true, false, true, true)).toBe(true);
  });

  it("lights on the very frame a pass starts, if that frame already overloaded", () => {
    // The clear and the set land together; the set has to win, or a clip in the first 50 ms would
    // be wiped by the same edge that was meant to make room for it.
    expect(clipLatch(true, true, true, false)).toBe(true);
  });
});
