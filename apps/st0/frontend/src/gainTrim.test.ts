// The Fix button's arithmetic. Two things here would be wrong silently and are the reason this
// is a pure file at all: a trim that comes out the wrong SIGN — a button that makes a mix that
// clipped louder — and a shared bus strip written twice, which is a race rather than a no-op.

import { describe, expect, it } from "vitest";
import { MAX_DB, MIN_DB, TARGET_DB, trimFor, trimmedStrips } from "./gainTrim";

const strip = (mixer: string, volume: number) => ({ mixer, volume });

describe("how far everything comes down", () => {
  it("brings the peak to the target", () => {
    expect(trimFor(0)).toBe(TARGET_DB); // hit full scale → down 6
    expect(trimFor(3)).toBe(-9);
    expect(trimFor(12)).toBe(-18);
  });

  // The guard that matters. `masterClipped` is a latched "one sample went over"; `master` is a
  // level read at 20 Hz. A single sample over the line inside a quiet-looking window would give
  // `TARGET_DB - peak` a positive value, and the button would turn a mix that clipped UP.
  it("never comes out positive, whatever the meter read", () => {
    expect(trimFor(-20)).toBeLessThanOrEqual(TARGET_DB);
    expect(trimFor(-60)).toBeLessThanOrEqual(TARGET_DB);
    expect(trimFor(Number.NEGATIVE_INFINITY)).toBe(TARGET_DB);
  });

  // …and the other half of that disagreement: the pass clipped, so it reached full scale whatever
  // the meter averaged out to. 0 dB is the least the peak can honestly be called, which is what
  // keeps the button from being one that does nothing.
  it("floors the peak at full scale, so the trim is at least the target", () => {
    expect(trimFor(-3)).toBe(TARGET_DB);
    expect(trimFor(0)).toBe(TARGET_DB);
  });
});

describe("which strips get it", () => {
  it("puts the SAME trim on every one, so the mix does not change", () => {
    const out = trimmedStrips(
      [strip("mixer:vo", -3), strip("mixer:gtr", -12), strip("mixer:bs", 0)],
      6,
    );
    // -12 off each: the balances between them are exactly what they were.
    expect(out).toEqual([
      { node: "mixer:vo", db: -15 },
      { node: "mixer:gtr", db: -24 },
      { node: "mixer:bs", db: -12 },
    ]);
  });

  it("writes a shared bus strip ONCE, in the order the first lane reached it", () => {
    // Two lanes ending on one strip. Twice is a wasted round trip at best, and — if the two
    // disagreed about its current level — a race between two absolute writes.
    const out = trimmedStrips(
      [strip("mixer:bus", -6), strip("mixer:vo", 0), strip("mixer:bus", -6)],
      0,
    );
    expect(out.map((s) => s.node)).toEqual(["mixer:bus", "mixer:vo"]);
  });

  it("skips a lane with no strip rather than inventing one", () => {
    // Not "at unity": a lane with nowhere to put a level has nothing here to lower.
    expect(trimmedStrips([strip("", 0), strip("mixer:vo", 0)], 0)).toEqual([
      { node: "mixer:vo", db: TARGET_DB },
    ]);
  });

  it("clamps to the fader's own range", () => {
    const out = trimmedStrips([strip("mixer:quiet", -57)], 0);
    // -63 does not exist: the write would be refused, and -60 is silence either way.
    expect(out).toEqual([{ node: "mixer:quiet", db: MIN_DB }]);
    expect(MAX_DB).toBe(6);
  });

  it("says nothing about a strip already at the value it would be written", () => {
    // Already on the floor: no command, rather than a round trip that changes nothing.
    expect(trimmedStrips([strip("mixer:off", MIN_DB)], 0)).toEqual([]);
  });

  it("still trims a pass whose meter never read loud, because it clipped", () => {
    // The button is only offered on a pass that CLIPPED, so the peak is floored at full scale and
    // the trim is never nothing — even here, where the level read is already at the target.
    expect(trimmedStrips([strip("mixer:vo", 0)], TARGET_DB)).toEqual([
      { node: "mixer:vo", db: TARGET_DB },
    ]);
  });
});
