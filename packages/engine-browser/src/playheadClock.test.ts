import { describe, expect, it } from "vitest";
import {
  advancePlayhead,
  feedPlayhead,
  HALT_HOLD_MS,
  haltPlayhead,
  newPlayheadClock,
  playheadAt,
  retimePlayhead,
  SEEK_EPS,
  shiftPlayhead,
  unhaltPlayhead,
  WINDOW_MS,
} from "./playheadClock";

// The rate is KNOWN, so the only unknown is the offset, and every frame measures it noisily in ONE direction — always understating.

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
    // The estimate is the least-delayed sample, so the line sits exactly that far behind and cannot do better.
    for (const r of rows)
      expect((r.truth - r.drawn) * 1000).toBeCloseTo(MIN_LAT, 1);
  });

  it("never goes backwards while rolling", () => {
    const rows = play(6000);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn).toBeGreaterThanOrEqual(rows[i - 1].drawn);
  });

  it("builds its estimate only from frames that arrived", () => {
    // Construction is not a measurement, so it contributes no sample: a clock seeded with a perfect value measures better than it is.
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
    // …and the OLD samples go with it: a max filter would otherwise prefer them forever, a jump forward making every later sample smaller.
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
    // Past the window only the 20 ms samples remain, so the estimate gave the millisecond back rather than trusting a four-second-old frame.
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

describe("playheadClock at a KNOWN rate other than one", () => {
  /** Play at `rate` for `ms`, with the same transit times, from `start`. */
  function playAt(rate: number, ms: number, start = 10) {
    let c = newPlayheadClock(start, true, 0, rate);
    const rows: { drawn: number; truth: number }[] = [];
    let next = 50;
    let i = 0;
    for (let now = 0; now <= ms; now += FRAME) {
      while (next + LAT[i % LAT.length] <= now) {
        const sampled = start + (rate * next) / 1000;
        c = feedPlayhead(c, true, sampled, next + LAT[i % LAT.length]);
        i++;
        next += 50;
      }
      c = advancePlayhead(c, now);
      rows.push({
        drawn: playheadAt(c, now),
        truth: start + (rate * now) / 1000,
      });
    }
    return rows;
  }

  it("draws a straight line at that rate", () => {
    const rows = playAt(1.25, 4000).slice(60);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn - rows[i - 1].drawn).toBeCloseTo(
        (1.25 * FRAME) / 1000,
        9,
      );
  });

  it("sits the best transit behind, scaled by the rate", () => {
    const rows = playAt(0.8, 6000).slice(120);
    for (const r of rows)
      expect((r.truth - r.drawn) * 1000).toBeCloseTo(0.8 * MIN_LAT, 1);
  });

  it("runs backwards, keeping the least delayed frame of that direction", () => {
    const rows = playAt(-1, 4000, 20).slice(120);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn).toBeLessThanOrEqual(rows[i - 1].drawn);
    for (const r of rows)
      expect((r.drawn - r.truth) * 1000).toBeCloseTo(MIN_LAT, 1);
  });

  it("keeps the drawn position continuous across a new rate", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 1000; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    c = advancePlayhead(c, 1000);
    const before = playheadAt(c, 1000);
    c = retimePlayhead(c, 1.5, 1000);
    expect(playheadAt(c, 1000)).toBeCloseTo(before, 9);
    c = advancePlayhead(c, 1100);
    expect(playheadAt(c, 1100)).toBeCloseTo(before + 0.15, 6);
    // The evidence is kept, rebased onto the new rate.
    expect(c.window.length).toBeGreaterThan(1);
  });

  it("drops its evidence on a reversal, which pointed the other way", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 500; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    c = retimePlayhead(c, -1, 500);
    expect(c.window).toHaveLength(0);
  });

  it("is unchanged by the rate it already has", () => {
    const c = newPlayheadClock(3, true, 100, 2);
    expect(retimePlayhead(c, 2, 500)).toBe(c);
  });

  it("slides under a shift without the drawn position moving relative to it", () => {
    let c = newPlayheadClock(0, true, 0);
    c = feedPlayhead(c, true, 0.5, 505);
    c = advancePlayhead(c, 600);
    const before = playheadAt(c, 600);
    c = shiftPlayhead(c, -0.25);
    expect(playheadAt(c, 600)).toBeCloseTo(before - 0.25, 9);
  });

  it("takes a tighter seek threshold when asked", () => {
    let c = newPlayheadClock(0, true, 0);
    for (let t = 50; t <= 1000; t += 50)
      c = feedPlayhead(c, true, t / 1000, t + 5);
    c = feedPlayhead(c, true, 1.2, 1055, 0.1);
    expect(c.window).toHaveLength(1);
  });

  describe("a stop pressed here", () => {
    /** Rolling from 0 at local time 0, frames arriving 10 ms after they were sampled. */
    const rolling = () => {
      let c = newPlayheadClock(0, true, 0);
      for (let t = 50; t <= 1000; t += 50)
        c = feedPlayhead(c, true, t / 1000, t + 10);
      return advancePlayhead(c, 1010);
    };

    it("freezes the line where it is drawn at the press", () => {
      const c = rolling();
      const at = playheadAt(c, 1010);
      const h = haltPlayhead(c, 1010);
      expect(h.playing).toBe(false);
      expect(playheadAt(h, 1080)).toBe(at);
    });

    it("ignores the frames already in flight, which would roll it on past the stop", () => {
      const h = haltPlayhead(rolling(), 1010);
      const late = feedPlayhead(h, true, 1.05, 1060);
      expect(late.playing).toBe(false);
      expect(playheadAt(late, 1060)).toBe(playheadAt(h, 1010));
    });

    it("takes the engine's stopped frame as the answer, and lifts the hold", () => {
      const h = haltPlayhead(rolling(), 1010);
      const done = feedPlayhead(h, false, 1.003, 1070);
      expect(playheadAt(done, 1070)).toBe(1.003);
      expect(done.haltedAt).toBeUndefined();
    });

    it("gives up the hold when no stop ever comes back", () => {
      const h = haltPlayhead(rolling(), 1010);
      const back = feedPlayhead(h, true, 1.6, 1010 + HALT_HOLD_MS + 1);
      expect(back.playing).toBe(true);
      expect(back.haltedAt).toBeUndefined();
    });

    it("lets a play pressed before the stop came back roll at once", () => {
      const h = unhaltPlayhead(haltPlayhead(rolling(), 1010));
      expect(feedPlayhead(h, true, 1.02, 1100).playing).toBe(true);
    });
  });
});
