// A crossfade is an overlap found in material the two events do not play yet: B earlier first, then A later.

import { describe, expect, it } from "vitest";
import { planCrossfade } from "./crossfade";

// 120 bpm: a beat is half a second. A plays beats 0..8 (0..4 s of its file), B starts at 8.
const a = { start: 0, length: 8, from: 0, to: 4, matFrom: 0, matTo: 10 };
const b = { start: 8, length: 8, from: 2, to: 6, matFrom: 0, matTo: 10 };

describe("planCrossfade", () => {
  it("pulls B earlier into the material it does not play yet", () => {
    expect(planCrossfade(a, b, 1, 120)).toEqual({
      bStart: 7,
      bFrom: 1.5,
      length: 1,
    });
  });

  it("opens A later for what B has not got", () => {
    const tight = { ...b, from: 0.25 };
    expect(planCrossfade(a, tight, 2, 120)).toEqual({
      bStart: 7.5,
      bFrom: 0,
      aTo: 4.75,
      length: 2,
    });
  });

  it("shrinks an overlap that is longer than asked, from B's side", () => {
    const over = { ...b, start: 6, from: 1 };
    expect(planCrossfade(a, over, 1, 120)).toEqual({
      bStart: 7,
      bFrom: 1.5,
      length: 1,
    });
  });

  it("says no when neither has any material to give", () => {
    expect(
      planCrossfade({ ...a, matTo: 4 }, { ...b, from: 0 }, 1, 120),
    ).toBeNull();
  });
});
