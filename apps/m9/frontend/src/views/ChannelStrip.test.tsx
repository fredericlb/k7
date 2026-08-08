import { describe, expect, it } from "vitest";
import { EQ_DB, FILTER_RANGE } from "../deck";
import { angleOf } from "./ChannelStrip";

describe("where a value sits on the dial", () => {
  it("puts flat straight up", () => {
    // The one position that has to be unmistakable: a knob whose 0 dB is not at twelve
    // o'clock is read wrong at every glance, which is why the control's range is symmetric.
    expect(angleOf(0, EQ_DB)).toBeCloseTo(0);
  });

  it("sweeps the same distance either way", () => {
    const [lo, hi] = EQ_DB;
    expect(angleOf(hi, EQ_DB)).toBeCloseTo(-angleOf(lo, EQ_DB));
    expect(Math.abs(angleOf(hi, EQ_DB))).toBe(150);
  });

  it("stops at the ends rather than winding past them", () => {
    // A dial that kept turning would show a boost it is not applying: the value is clamped
    // where it is SENT too, but a pointer past the stop is the visible half of that lie.
    expect(angleOf(999, EQ_DB)).toBe(angleOf(EQ_DB[1], EQ_DB));
    expect(angleOf(-999, EQ_DB)).toBe(angleOf(EQ_DB[0], EQ_DB));
  });

  it("says nothing for a range with no width", () => {
    expect(angleOf(5, [3, 3])).toBe(0);
  });

  it("reads the FILTER's own range, not the EQ's", () => {
    // Two scales on one strip: ±20 dB and ±100. The dial takes the range it is given rather
    // than assuming one, or the filter would sit pinned at an end from its first degree.
    expect(angleOf(0, FILTER_RANGE)).toBeCloseTo(0);
    expect(angleOf(-100, FILTER_RANGE)).toBe(angleOf(EQ_DB[0], EQ_DB));
    expect(angleOf(20, FILTER_RANGE)).toBeCloseTo(30);
  });
});
