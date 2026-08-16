import { describe, expect, it } from "vitest";
import {
  advancePlayhead,
  feedPlayhead,
  newPlayheadClock,
  playheadAt,
  SEEK_EPS,
  WINDOW_MS,
} from "./playheadClock";

// The transport's rate is KNOWN — one second per second — so the only unknown is the offset
// between the engine's clock and ours, and every frame is a noisy measurement of it. Noisy in
// ONE direction: a frame is sampled and then travels, so it always understates the offset. What
// these pin is that the estimate takes the least-delayed frame, that the drawn line is a
// straight one, and that a real jump rolls the estimate back instead of being averaged in.

const FRAME = 1000 / 60;
/** Transit times, in ms. Never negative — a frame cannot arrive before it was sampled. */
const LAT = [4, 9, 6, 31, 5, 12, 7, 22, 4, 8, 55, 6];
const MIN_LAT = Math.min(...LAT);

/** Play for `ms`, feeding frames every 50 ms with those transit times. */
function play(ms: number, lat: number[] = LAT) {
  let c = newPlayheadClock(0, true, 0);
  const rows: { t: number; drawn: number; truth: number }[] = [];
  let next = 50;
  let i = 0;
  for (let now = 0; now <= ms; now += FRAME) {
    while (next + lat[i % lat.length] <= now) {
      // Sampled at `next`, arrives later — which is the whole problem.
      c = feedPlayhead(c, true, next / 1000, next + lat[i % lat.length]);
      i++;
      next += 50;
    }
    c = advancePlayhead(c, now);
    rows.push({ t: now, drawn: playheadAt(c, now), truth: now / 1000 });
  }
  return rows;
}

describe("playheadClock", () => {
  it("draws a STRAIGHT line — the frames move the offset, never the position", () => {
    const rows = play(4000).slice(60);
    const steps = rows.slice(1).map((r, i) => r.drawn - rows[i].drawn);
    // Every step identical to the last: a known rate means there is nothing per-frame to correct.
    for (const s of steps) expect(s).toBeCloseTo(FRAME / 1000, 9);
  });

  it("settles at the BEST frame's latency, not the average one", () => {
    const rows = play(6000).slice(120);
    // The estimate is the least-delayed sample, so the line sits exactly that far behind. It
    // cannot do better: 4 ms is how stale the freshest thing we were told actually is.
    for (const r of rows)
      expect((r.truth - r.drawn) * 1000).toBeCloseTo(MIN_LAT, 1);
  });

  it("never goes backwards while rolling", () => {
    const rows = play(6000);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn).toBeGreaterThanOrEqual(rows[i - 1].drawn);
  });

  it("builds its estimate only from frames that arrived", () => {
    // Construction is not a measurement, so it contributes no sample. The property matters less
    // for correctness than for honesty: a clock seeded with a perfect value measures better than
    // it is, and the first version of the bench above was flattered by exactly that.
    const c = newPlayheadClock(12.5, true, 1000);
    expect(c.window).toHaveLength(0);
    expect(feedPlayhead(c, true, 13, 1500).window).toHaveLength(1);
  });

  it("rolls the estimate back on a seek instead of averaging it in", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 2000; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    c = advancePlayhead(c, 2000);
    // Eight seconds back. Every sample in the window describes a position that is now gone.
    c = feedPlayhead(c, true, 10.0, 2010);
    c = advancePlayhead(c, 2016);
    expect(playheadAt(c, 2016)).toBeCloseTo(10.006, 2);
    // …and the OLD samples are gone with it: a max filter would otherwise prefer them forever,
    // because a jump forward makes every later sample smaller.
    expect(c.window).toHaveLength(1);
  });

  it("rolls back on a loop wrap, which is a seek backwards", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 2000; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    c = feedPlayhead(c, true, 0.02, 2010); // wrapped to the top
    c = advancePlayhead(c, 2026);
    expect(playheadAt(c, 2026)).toBeLessThan(0.1);
    expect(c.window).toHaveLength(1);
  });

  it("ages a sample out, so a drifting clock cannot be held by one old best frame", () => {
    let c = newPlayheadClock(0, true, 0);
    c = feedPlayhead(c, true, 0.05, 51); // a 1 ms transit — the best there will be
    for (let t = 100; t <= WINDOW_MS + 400; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 20);
    // Past the window, only the 20 ms samples remain, so the estimate has given the millisecond
    // back rather than trusting a frame from four seconds ago.
    expect(c.window.every((s) => s.at > WINDOW_MS + 400 - WINDOW_MS)).toBe(
      true,
    );
    expect((0 - c.offset) * 1000).toBeCloseTo(20, 0);
  });

  it("re-seats on a play edge rather than easing across the gap", () => {
    let c = newPlayheadClock(4, false, 0);
    c = advancePlayhead(c, 100);
    expect(playheadAt(c, 100)).toBe(4); // stopped: the frame IS the answer
    c = feedPlayhead(c, true, 4, 100);
    c = advancePlayhead(c, 116);
    expect(playheadAt(c, 116)).toBeCloseTo(4.016, 3);
  });

  it("holds still while stopped, whatever time does", () => {
    let c = newPlayheadClock(12.5, false, 0);
    for (let now = 0; now < 1000; now += FRAME) c = advancePlayhead(c, now);
    expect(playheadAt(c, 1000)).toBe(12.5);
  });

  it("follows a scrub while stopped, with no easing at all", () => {
    let c = newPlayheadClock(12.5, false, 0);
    c = feedPlayhead(c, false, 3.25, 50);
    c = advancePlayhead(c, 66);
    expect(playheadAt(c, 66)).toBe(3.25);
  });

  it("treats a frame inside SEEK_EPS as latency, not as a jump", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 1000; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    const before = c.window.length;
    // 200 ms late — ugly, under the threshold, and therefore evidence rather than an event.
    c = feedPlayhead(c, true, 1.05, 1255);
    expect(c.window.length).toBeGreaterThan(before - 1);
    expect(0.2).toBeLessThan(SEEK_EPS);
  });
});
