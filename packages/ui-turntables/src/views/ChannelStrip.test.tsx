import { STEMS } from "@studio/song-schema/stems";
import { describe, expect, it } from "vitest";
import { EQ_BANDS as BANDS, EQ_DB, FILTER_RANGE } from "../deck";
import {
  angleOf,
  arcPath,
  EQ_ICONS,
  STEM_GRID,
  STEM_ICONS,
} from "./ChannelStrip";

describe("where a value sits on the dial", () => {
  it("puts flat straight up", () => {
    // The position that must be unmistakable, and why the control's range is symmetric.
    expect(angleOf(0, EQ_DB)).toBeCloseTo(0);
  });

  it("sweeps the same distance either way", () => {
    const [lo, hi] = EQ_DB;
    expect(angleOf(hi, EQ_DB)).toBeCloseTo(-angleOf(lo, EQ_DB));
    expect(Math.abs(angleOf(hi, EQ_DB))).toBe(150);
  });

  it("stops at the ends rather than winding past them", () => {
    // A dial that kept turning would show a boost it is not applying — the value is clamped when sent.
    expect(angleOf(999, EQ_DB)).toBe(angleOf(EQ_DB[1], EQ_DB));
    expect(angleOf(-999, EQ_DB)).toBe(angleOf(EQ_DB[0], EQ_DB));
  });

  it("says nothing for a range with no width", () => {
    expect(angleOf(5, [3, 3])).toBe(0);
  });

  it("reads the FILTER's own range, not the EQ's", () => {
    // Two scales on one strip, ±20 dB and ±100 — an assumed one would pin the filter at an end.
    expect(angleOf(0, FILTER_RANGE)).toBeCloseTo(0);
    expect(angleOf(-100, FILTER_RANGE)).toBe(angleOf(EQ_DB[0], EQ_DB));
    expect(angleOf(20, FILTER_RANGE)).toBeCloseTo(30);
  });
});

// The arc from twelve o'clock to the knob — what says HOW MUCH once the readouts go (../docs/eq.md).
describe("the value arc", () => {
  it("draws nothing at rest", () => {
    // An untouched knob shows an empty dial, not a stub: a column of stubs is the same noise.
    expect(arcPath(0, 18)).toBe("");
    expect(arcPath(angleOf(0, EQ_DB), 18)).toBe("");
  });

  it("starts at twelve o'clock, whichever way it goes", () => {
    // Neutral is the anchor: one growing from the bottom would say how loud, never how far from flat.
    for (const deg of [30, -30, 150, -150])
      expect(arcPath(deg, 18), `at ${deg}`).toMatch(/^M 20 2 /);
  });

  it("sweeps clockwise for a boost and anticlockwise for a cut", () => {
    // The sweep flag IS the direction: backwards draws the 330° complement, which reads as pinned.
    expect(arcPath(90, 18)).toContain("A 18 18 0 0 1");
    expect(arcPath(-90, 18)).toContain("A 18 18 0 0 0");
  });

  it("is symmetric: equal cut and boost draw the same length of arc", () => {
    // A dial whose cut looked smaller than its boost would be read as one, all evening.
    const up = arcPath(60, 18);
    const down = arcPath(-60, 18);
    const endOf = (d: string) => d.split(" ").slice(-2).map(Number);
    const [ux, uy] = endOf(up);
    const [dx, dy] = endOf(down);
    expect(uy).toBeCloseTo(dy);
    expect(ux - 20).toBeCloseTo(20 - dx);
  });

  it("says nothing for a radius that is not one", () => {
    // Guarded, not trusted: the size is computed, and a zero would reach the DOM as two NaNs.
    expect(arcPath(90, 0)).toBe("");
    expect(arcPath(90, -4)).toBe("");
  });
});

describe("the stem block's reading order", () => {
  it("draws every stem, exactly once", () => {
    // A fifth source added to STEMS must not go missing from the desk in silence.
    expect([...STEM_GRID].sort()).toEqual([...STEMS].sort());
  });

  it("puts the rhythm section on the top row", () => {
    // Two by two, and WHICH two: a hand reaches for the drums without reading the labels.
    expect(STEM_GRID.slice(0, 2)).toEqual(["drums", "bass"]);
    expect(STEM_GRID.slice(2)).toEqual(["vocals", "other"]);
  });
});

describe("the glyph on each knob", () => {
  it("gives every stem one", () => {
    // A missing entry draws no icon and says nothing — the knob renders whatever it is handed.
    for (const s of STEMS) expect(STEM_ICONS[s], s).toBeTruthy();
  });

  it("gives every EQ band one, keyed by the band's OWN id", () => {
    // Keyed by id rather than by position, so reordering EQ_BANDS cannot silently shuffle them.
    for (const b of BANDS) expect(EQ_ICONS[b.id], b.id).toBeTruthy();
  });
});
