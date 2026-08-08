import { describe, expect, it } from "vitest";
import { meterFill, meterLabel } from "./InputMeter";

describe("meterFill", () => {
  it("puts the useful range where the gesture is", () => {
    // -60..0, not -100..0: under -60 there is nothing to set, and spreading forty dB of
    // silence squashes the part somebody is actually riding.
    expect(meterFill(0)).toBe(1);
    expect(meterFill(-30)).toBeCloseTo(0.5, 5);
    expect(meterFill(-60)).toBe(0);
  });

  it("clamps rather than overflowing its box", () => {
    // The engine's floor is -100 and a hot input can read above 0; neither should draw
    // outside the rail.
    expect(meterFill(-100)).toBe(0);
    expect(meterFill(6)).toBe(1);
  });

  it("reads a missing level as empty, not as full", () => {
    // A frame that has not arrived is `undefined` upstream; NaN through the arithmetic would
    // otherwise come out as a bar of some arbitrary width.
    expect(meterFill(Number.NaN)).toBe(0);
    expect(meterFill(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("meterLabel", () => {
  it("writes the level while there is one", () => {
    expect(meterLabel(-12.4)).toBe("-12 dB");
    expect(meterLabel(0)).toBe("0 dB");
  });

  it("says nothing rather than -100 when there is nothing", () => {
    // The engine sends -100 both for silence and for a track with no input assigned. The two
    // read the same on purpose: either way there is nothing to hear.
    expect(meterLabel(-100)).toBe("—");
    expect(meterLabel(-60)).toBe("—");
    expect(meterLabel(Number.NaN)).toBe("—");
  });
});
