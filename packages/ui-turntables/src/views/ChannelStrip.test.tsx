import { describe, expect, it } from "vitest";
import { EQ_DB, FILTER_RANGE } from "../deck";
import { angleOf, arcPath } from "./ChannelStrip";

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

// The arc from twelve o'clock to where the knob is — the value, drawn. It is what says HOW MUCH
// on a short strip, where the numeric readouts are dropped for height (../deskLayout.ts).
describe("the value arc", () => {
  it("draws nothing at rest", () => {
    // An untouched knob shows an empty dial, not a stub. A column of knobs each wearing a
    // two-pixel mark is exactly the noise the readouts were dropped to avoid.
    expect(arcPath(0, 18)).toBe("");
    expect(arcPath(angleOf(0, EQ_DB), 18)).toBe("");
  });

  it("starts at twelve o'clock, whichever way it goes", () => {
    // Neutral is the anchor: the arc's LENGTH is the amount, so both ends of it have to mean
    // something. One that grew from the bottom would say how loud, never how far from flat.
    for (const deg of [30, -30, 150, -150])
      expect(arcPath(deg, 18), `at ${deg}`).toMatch(/^M 20 2 /);
  });

  it("sweeps clockwise for a boost and anticlockwise for a cut", () => {
    // The sweep flag IS the direction, and getting it backwards draws the 330° complement of
    // the arc that was wanted — which looks like a knob pinned the other way.
    expect(arcPath(90, 18)).toContain("A 18 18 0 0 1");
    expect(arcPath(-90, 18)).toContain("A 18 18 0 0 0");
  });

  it("is symmetric: equal cut and boost draw the same length of arc", () => {
    // Both land the same distance from the top, on opposite sides. A dial whose cut looked
    // smaller than its boost would be read as one, all evening.
    const up = arcPath(60, 18);
    const down = arcPath(-60, 18);
    const endOf = (d: string) => d.split(" ").slice(-2).map(Number);
    const [ux, uy] = endOf(up);
    const [dx, dy] = endOf(down);
    expect(uy).toBeCloseTo(dy);
    expect(ux - 20).toBeCloseTo(20 - dx);
  });

  it("says nothing for a radius that is not one", () => {
    // Guarded rather than trusted: the size is computed from the room there is, and a zero
    // would otherwise reach the DOM as a path with two NaNs in it.
    expect(arcPath(90, 0)).toBe("");
    expect(arcPath(90, -4)).toBe("");
  });
});
