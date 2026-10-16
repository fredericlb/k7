import { describe, expect, it } from "vitest";
import {
  foldIntoLoop,
  NEEDLE_SEEK_EPS,
  type NeedleClock,
  type NeedleInput,
  newNeedleClock,
  readNeedle,
  STALL_MS,
  unwrapNear,
} from "./needleClock";

// The platter reports its needle at 20 Hz with jittered transit; the band reads it at 60 fps and must move evenly.

const FRAME = 1000 / 60;
const LAT = [4, 9, 6, 31, 5, 12, 7, 22, 4, 8, 45, 6];

/** A platter at `rate` from `start`, read every animation frame; `loop` wraps the needle as the engine does. */
function run(
  rate: number,
  ms: number,
  opts: { start?: number; loop?: { start: number; end: number } | null } = {},
) {
  const start = opts.start ?? 10;
  const loop = opts.loop ?? null;
  const truthAt = (t: number) => foldIntoLoop(start + (rate * t) / 1000, loop);
  let s: NeedleClock = newNeedleClock(start, 0);
  let raw = start;
  let next = 50;
  let i = 0;
  const rows: { drawn: number; truth: number; raw: number }[] = [];
  for (let now = 0; now <= ms; now += FRAME) {
    while (next + LAT[i % LAT.length] <= now) {
      raw = truthAt(next);
      i++;
      next += 50;
    }
    const input: NeedleInput = { raw, rate, loop };
    const r = readNeedle(s, input, now);
    s = r.state;
    rows.push({ drawn: r.at, truth: truthAt(now), raw });
  }
  return rows;
}

describe("needleClock", () => {
  it("moves EVERY frame by the same step, where the raw needle stands still on two frames in three", () => {
    const rows = run(1, 3000).slice(60);
    const still = rows.slice(1).filter((r, i) => r.raw === rows[i].raw).length;
    expect(still).toBeGreaterThan(rows.length / 2);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn - rows[i - 1].drawn).toBeCloseTo(FRAME / 1000, 9);
  });

  it("runs at the deck's rate, not the transport's", () => {
    const rows = run(0.9, 3000).slice(60);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].drawn - rows[i - 1].drawn).toBeCloseTo(
        (0.9 * FRAME) / 1000,
        9,
      );
  });

  it("stays within the best transit plus one frame of the truth", () => {
    // A frame is SEEN on the next animation frame, not when it lands, so that wait adds to its transit.
    const rows = run(1, 4000).slice(60);
    for (const r of rows)
      expect(Math.abs(r.truth - r.drawn)).toBeLessThan(
        (4 + FRAME) / 1000 + 1e-9,
      );
  });

  it("draws the raw needle verbatim at rate 0 — stopped, or under a hand", () => {
    let s = newNeedleClock(5, 0);
    const a = readNeedle(s, { raw: 5, rate: 0, loop: null }, 100);
    s = a.state;
    expect(a.at).toBe(5);
    expect(readNeedle(s, { raw: 4.2, rate: 0, loop: null }, 120).at).toBe(4.2);
  });

  it("does not run ahead of a platter that has not left its groove yet", () => {
    // Started, but the engine has not answered: the needle stands, so the drawing does too.
    let s = newNeedleClock(7, 0);
    for (let now = 0; now < 400; now += FRAME) {
      const r = readNeedle(s, { raw: 7, rate: 1, loop: null }, now);
      s = r.state;
      expect(r.at).toBe(7);
    }
  });

  it("stops extrapolating once the needle stalls — the record ran out", () => {
    let s = newNeedleClock(0, 0);
    let at = 0;
    for (let now = 0; now <= 1000; now += FRAME) {
      const raw = Math.min(0.5, Math.floor(now / 50) * 0.05);
      const r = readNeedle(s, { raw, rate: 1, loop: null }, now);
      s = r.state;
      at = r.at;
    }
    expect(at).toBe(0.5);
    expect(STALL_MS).toBeLessThan(500);
  });

  it("folds into a running loop, never drawing past its end", () => {
    const loop = { start: 10, end: 10.25 };
    const rows = run(1, 4000, { start: 10, loop }).slice(60);
    for (const r of rows) {
      expect(r.drawn).toBeGreaterThanOrEqual(loop.start);
      expect(r.drawn).toBeLessThan(loop.end);
    }
    // A wrap is not a seek: away from the edges, the drawing keeps up with the truth.
    const mid = rows.filter(
      (r) =>
        r.truth > 10.05 && r.truth < 10.2 && r.drawn > 10.05 && r.drawn < 10.2,
    );
    for (const r of mid)
      expect(Math.abs(r.truth - r.drawn)).toBeLessThan(
        (4 + FRAME) / 1000 + 1e-9,
      );
  });

  it("snaps to a jump past the threshold rather than sliding to it", () => {
    let s = newNeedleClock(0, 0);
    let now = 0;
    for (; now <= 1000; now += FRAME) {
      const raw = Math.floor(now / 50) * 0.05;
      s = readNeedle(s, { raw, rate: 1, loop: null }, now).state;
    }
    const jumped = readNeedle(s, { raw: 30, rate: 1, loop: null }, now);
    expect(jumped.at).toBeCloseTo(30, 6);
    expect(NEEDLE_SEEK_EPS).toBeLessThan(0.3);
  });
});

describe("loop folding", () => {
  const loop = { start: 2, end: 3 };
  it("leaves a position before the end alone", () => {
    expect(foldIntoLoop(2.5, loop)).toBe(2.5);
    expect(foldIntoLoop(1, loop)).toBe(1);
  });
  it("brings a position past the end back by whole turns", () => {
    expect(foldIntoLoop(3.25, loop)).toBeCloseTo(2.25, 9);
    expect(foldIntoLoop(5.5, loop)).toBeCloseTo(2.5, 9);
  });
  it("unwraps a needle to the turn nearest the prediction", () => {
    expect(unwrapNear(2.1, 4.05, loop)).toBeCloseTo(4.1, 9);
    expect(unwrapNear(2.9, 2.85, loop)).toBe(2.9);
    expect(unwrapNear(5, 5, loop)).toBe(5);
  });
});
