// A meter's three pure decisions: where the bar sits, when the clip light clears, and what the peak
// a "fix this" offer spends is worth.
//
// Only the arithmetic and the two RULES are here — no component mounts. What that leaves testable is
// the part that would be wrong silently: a scale that reads the floor as full, a light that clears on
// the wrong event, and a peak that clears on a different one from the light.
//
// It lives here rather than beside k7's header meter because the DJ desk draws the same bar off the
// same frames, and these are the functions both of them read.

import { describe, expect, it } from "vitest";
import {
  clipLatch,
  FLOOR_DB,
  meterFill,
  meterZone,
  newPass,
  nextPeakMark,
  PEAK_HOLD_MS,
  peakHold,
  peakMarkLevel,
} from "./meter";

describe("the bar", () => {
  it("is empty at the floor and full at 0 dB", () => {
    expect(meterFill(FLOOR_DB)).toBe(0);
    expect(meterFill(0)).toBe(1);
  });

  it("spends most of its length on the top 20 dB, where a mix is judged", () => {
    expect(meterFill(-20)).toBeCloseTo(0.4, 6);
    expect(meterFill(-6)).toBeCloseTo(0.8, 6);
    // Equal dB is still equal distance WITHIN a stretch: the markings stay readable between corners.
    expect(meterFill(-13)).toBeCloseTo(0.6, 6);
  });

  it("only ever climbs as the level does", () => {
    let last = -1;
    for (let db = -70; db <= 6; db += 0.5) {
      const f = meterFill(db);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });

  it("reads NaN and -Infinity as empty, which is what a silent frame can carry", () => {
    expect(meterFill(Number.NaN)).toBe(0);
    expect(meterFill(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("clamps rather than running off either end", () => {
    // -100 is what the engine sends for 'silent' and for 'no meter to ask'; above 0 dB there is no more bar, only the light.
    expect(meterFill(-100)).toBe(0);
    expect(meterFill(6)).toBe(1);
  });
});

describe("the clip light", () => {
  // `clipLatch(lit, overloadNow, playing, wasPlaying)` → whether it is lit after this frame.
  it("lights on an overload and STAYS lit after the transport stops", () => {
    // The whole point: the overload is reported for one 50 ms window, and a light that told the truth only then is one nobody sees.
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
    // The clear and the set land together, and the set has to win: a clip in the first 50 ms would else be wiped by the same edge.
    expect(clipLatch(true, true, true, false)).toBe(true);
  });
});

describe("the peak the Fix button spends", () => {
  // `peakHold(held, now, playing, wasPlaying)` → the peak after this frame.
  it("keeps the loudest of the pass, not the latest frame", () => {
    // The whole reason it is held: by the time the button is pressed the transport has stopped and `master` reads silence.
    expect(peakHold(-20, -30, true, true)).toBe(-20);
    expect(peakHold(-20, -3, true, true)).toBe(-3);
    expect(peakHold(-3, -100, false, false)).toBe(-3); // …and survives the stop
  });

  it("restarts on a NEW pass, on the same edge the light clears on", () => {
    // The light and the number answer one question, so a peak that outlived the light would offer a trim from a pass nobody sees.
    expect(peakHold(0, -40, true, false)).toBe(-40);
    // Still rolling is not a new pass.
    expect(peakHold(0, -40, true, true)).toBe(0);
  });

  it("restarts from THIS frame's level, not from the floor", () => {
    // A pass that opens loud is metered from its first frame: starting at -Infinity, only that frame could seed it.
    expect(peakHold(-60, 2, true, false)).toBe(2);
  });
});

describe("the edge all three clear on", () => {
  // `newPass` is the one event that makes the light, the peak and the taken offer stale — pinned because three behaviours read it.
  it("is the RISING edge of playing, and nothing else", () => {
    expect(newPass(true, false)).toBe(true);
    expect(newPass(true, true)).toBe(false); // still rolling
    expect(newPass(false, true)).toBe(false); // stopping is not a new pass
    expect(newPass(false, false)).toBe(false);
  });

  it("is what the light and the peak are written in terms of", () => {
    // The same frame, the same answer from both — a clear that drifted would leave a peak behind a light that had reset.
    expect(clipLatch(true, false, true, false)).toBe(false);
    expect(peakHold(0, -40, true, false)).toBe(-40);
  });
});

describe("the bar's colour", () => {
  it("is ok below -6, hot from -6, clipped from full scale", () => {
    expect(meterZone(-12)).toBe("ok");
    expect(meterZone(-6)).toBe("hot");
    expect(meterZone(-0.1)).toBe("hot");
    expect(meterZone(0)).toBe("clip");
  });
});

describe("the peak mark", () => {
  const raised = { db: -3, at: 1000 };

  it("holds where the loudest moment put it", () => {
    expect(peakMarkLevel(raised, 1000 + PEAK_HOLD_MS)).toBe(-3);
  });

  it("then falls at 20 dB a second, and never below the floor", () => {
    expect(peakMarkLevel(raised, 1000 + PEAK_HOLD_MS + 500)).toBeCloseTo(
      -13,
      6,
    );
    expect(peakMarkLevel(raised, 1000 + PEAK_HOLD_MS + 60_000)).toBe(FLOOR_DB);
  });

  it("does not compound its fall from one frame to the next", () => {
    // Fed quieter frames all the way down, the mark is where the release alone puts it.
    let mark = raised;
    for (let t = 1000; t <= 1000 + PEAK_HOLD_MS + 500; t += 50)
      mark = nextPeakMark(mark, -40, t, false);
    expect(peakMarkLevel(mark, 1000 + PEAK_HOLD_MS + 500)).toBeCloseTo(-13, 6);
  });

  it("is raised, and its hold restarted, by anything at or above where it stands", () => {
    const later = 1000 + PEAK_HOLD_MS + 500;
    expect(nextPeakMark(raised, -10, later, false)).toEqual({
      db: -10,
      at: later,
    });
    expect(nextPeakMark(raised, -20, later, false)).toBe(raised);
  });

  it("starts over with a new pass, whatever it held", () => {
    expect(nextPeakMark(raised, -30, 1100, true)).toEqual({
      db: -30,
      at: 1100,
    });
  });
});
