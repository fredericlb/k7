// The Fix button's arithmetic. Two things here would be wrong silently and are the reason this is
// a pure file at all: a trim that comes out the wrong SIGN — a button that makes a mix that
// clipped louder — and a new output level computed ABSOLUTELY, which would forget the fader
// setting that helped cause the clip and undo it in the same click.

import { MASTER_MAX_DB, MASTER_MIN_DB } from "@studio/song/yaml/projectSchema";
import { describe, expect, it } from "vitest";
import { fixedMaster, TARGET_DB, trimFor } from "./gainTrim";

describe("how far the output comes down", () => {
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

describe("where the OUT node's Volume lands", () => {
  it("moves RELATIVE to what the fader already reads", () => {
    // The meter is downstream of this gain, so a pass played at +3 peaked at +6 BECAUSE of the
    // +3. Writing trimFor(peak) absolutely would land on -12 and throw that setting away.
    expect(fixedMaster(3, 6)).toBe(-9);
    expect(fixedMaster(-4, 0)).toBe(-10);
  });

  it("leaves a mix that was already at unity exactly one trim below it", () => {
    expect(fixedMaster(0, 0)).toBe(TARGET_DB);
  });

  it("clamps to the field, rather than writing a value that would be refused", () => {
    // The command refuses anything outside the range, so an unclamped value would make the button
    // fail silently on the quietest mixes instead of doing what it could.
    expect(fixedMaster(MASTER_MIN_DB + 2, 0)).toBe(MASTER_MIN_DB);
    expect(fixedMaster(MASTER_MAX_DB, 0)).toBeLessThan(MASTER_MAX_DB);
  });

  it("never comes back higher than it started, whatever the meter read", () => {
    // The same sign guard as `trimFor`, at the level the button actually writes.
    for (const peak of [-60, -6, 0, 12])
      expect(fixedMaster(-3, peak)).toBeLessThanOrEqual(-3);
  });

  it("still moves a pass whose meter never read loud, because it clipped", () => {
    // The button is only offered on a pass that CLIPPED, so the peak is floored at full scale and
    // the write is never a no-op — even here, where the level read is already at the target.
    expect(fixedMaster(0, TARGET_DB)).toBe(TARGET_DB);
  });
});
