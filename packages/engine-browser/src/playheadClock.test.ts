import { describe, expect, it } from "vitest";
import {
  advancePlayhead,
  feedPlayhead,
  newPlayheadClock,
  RATE_SPAN,
  SEEK_EPS,
} from "./playheadClock";

// The engine speaks every 50 ms and the screen draws every ~16 ms, so two frames in three are
// drawn from local time alone. What these pin is the steering: local time must carry the line,
// the engine must correct it without being copied, and a real jump must not be eased through.

const FRAME = 1000 / 60;

/** Run `ms` of animation frames, feeding the engine's own frames at `enginePeriod`. */
function play(opts: {
  ms: number;
  enginePeriod: number;
  /** Jitter added to each engine frame's arrival, in ms — the thing being filtered out. */
  jitter?: (i: number) => number;
}): { drawn: number[]; at: number[] } {
  const { ms, enginePeriod, jitter = () => 0 } = opts;
  let c = newPlayheadClock(0, true, 0);
  const drawn: number[] = [];
  const at: number[] = [];
  let nextEngine = enginePeriod;
  let i = 0;
  for (let now = 0; now <= ms; now += FRAME) {
    while (nextEngine <= now) {
      // The engine reports the truth for the moment it SAMPLED, and reaches us late.
      const sampled = nextEngine / 1000;
      c = feedPlayhead(c, true, sampled, nextEngine + jitter(i++));
      nextEngine += enginePeriod;
    }
    c = advancePlayhead(c, now);
    drawn.push(c.drawnSec);
    at.push(now);
  }
  return { drawn, at };
}

describe("playheadClock", () => {
  it("moves on every animation frame, not only when the engine speaks", () => {
    const { drawn } = play({ ms: 500, enginePeriod: 50 });
    // 20 Hz over 500 ms is 10 distinct positions; 60 Hz is ~30. The old code drew the former.
    const distinct = new Set(drawn.map((s) => s.toFixed(4)));
    expect(distinct.size).toBeGreaterThan(25);
  });

  it("keeps up with real time over a second", () => {
    const { drawn } = play({ ms: 1000, enginePeriod: 50 });
    expect(drawn[drawn.length - 1]).toBeCloseTo(1.0, 1);
  });

  it("never goes backwards while rolling, however the frames arrive", () => {
    // ±30 ms of arrival jitter on a 50 ms cadence — frames landing out of their slot entirely.
    const { drawn } = play({
      ms: 3000,
      enginePeriod: 50,
      jitter: (i) => [0, 28, -18, 9, -25, 31][i % 6],
    });
    for (let i = 1; i < drawn.length; i++)
      expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1]);
  });

  it("draws smoothly THROUGH arrival jitter rather than copying it", () => {
    // The measurement that matters: per-frame steps should be near-constant. Copying the
    // engine's position would make them alternate between 0 and a 50 ms lurch.
    const { drawn } = play({
      ms: 3000,
      enginePeriod: 50,
      jitter: (i) => [0, 28, -18, 9, -25, 31][i % 6],
    });
    const steps = drawn.slice(1).map((s, i) => s - drawn[i]);
    const settled = steps.slice(30); // past the first anchor
    const ideal = FRAME / 1000;
    for (const s of settled) {
      expect(s).toBeGreaterThan(ideal * (1 - RATE_SPAN) - 1e-9);
      expect(s).toBeLessThan(ideal * (1 + RATE_SPAN) + 1e-9);
    }
  });

  it("converges on the engine rather than drifting away from it", () => {
    const { drawn, at } = play({ ms: 4000, enginePeriod: 50 });
    const last = drawn.length - 1;
    // Within a frame or two of where the engine actually is — the local clock is steered, not free.
    expect(Math.abs(drawn[last] - at[last] / 1000)).toBeLessThan(0.05);
  });

  it("snaps on a seek instead of easing over it", () => {
    let c = newPlayheadClock(10, true, 0);
    c = advancePlayhead(c, 16);
    c = feedPlayhead(c, true, 2, 16); // eight seconds back: a seek
    c = advancePlayhead(c, 32);
    expect(c.drawnSec).toBeCloseTo(2.016, 2);
  });

  it("snaps on a loop wrap, which is a seek backwards", () => {
    let c = newPlayheadClock(7.9, true, 0);
    c = feedPlayhead(c, true, 0.02, 50); // wrapped to the top of the loop
    c = advancePlayhead(c, 66);
    expect(c.drawnSec).toBeLessThan(0.1);
  });

  it("re-seats on a play edge rather than easing across the gap", () => {
    let c = newPlayheadClock(4, false, 0);
    c = advancePlayhead(c, 100);
    expect(c.drawnSec).toBe(4); // stopped: the frame IS the answer
    c = feedPlayhead(c, true, 4, 100); // Play, from where it rested
    c = advancePlayhead(c, 116);
    expect(c.drawnSec).toBeCloseTo(4.016, 3);
  });

  it("holds still while stopped, whatever the frames say about time passing", () => {
    let c = newPlayheadClock(12.5, false, 0);
    for (let now = 0; now < 1000; now += FRAME) c = advancePlayhead(c, now);
    expect(c.drawnSec).toBe(12.5);
  });

  it("follows a scrub while stopped, with no easing at all", () => {
    let c = newPlayheadClock(12.5, false, 0);
    c = feedPlayhead(c, false, 3.25, 50);
    c = advancePlayhead(c, 66);
    expect(c.drawnSec).toBe(3.25);
  });

  it("corrects a drift smaller than SEEK_EPS without a jump", () => {
    let c = newPlayheadClock(0, true, 0);
    // Local time has run 120 ms ahead of the engine — under the seek threshold, so it must be
    // absorbed by the rate rather than yanked back.
    c = feedPlayhead(c, true, 0, 0);
    c = { ...c, drawnSec: 0.12, drawnAt: 0 };
    const before = c.drawnSec;
    c = advancePlayhead(c, FRAME);
    expect(c.drawnSec).toBeGreaterThanOrEqual(before); // no backwards yank
    expect(c.drawnSec - before).toBeLessThan(
      (FRAME / 1000) * (1 - RATE_SPAN) + 1e-9,
    );
    expect(0.12).toBeLessThan(SEEK_EPS);
  });
});
