// `decimate` alone — the drawing half, split from the accumulation when that moved to
// @studio/engine-browser so it could outlive the card (packages/song/docs/recorderNode.md).

import { describe, expect, it } from "vitest";
import { decimate, type EnvPoint, GrowingDecimate } from "./decimate";

const pt = (v: number): EnvPoint => ({ min: -v, max: v });

describe("decimate", () => {
  const ramp = Array.from({ length: 100 }, (_, i) => pt(i));

  it("keeps the EXTREMES rather than averaging them away", () => {
    // The whole point of a waveform. An averaging decimator draws a quiet take, which is the
    // failure that looks like a working feature.
    const out = decimate(ramp, 10);
    expect(out).toHaveLength(10);
    expect(out[9].max).toBe(99);
    expect(out[9].min).toBe(-99);
    expect(out[0].max).toBe(9);
  });

  it("covers every point, leaving no gap between buckets", () => {
    const spike = [pt(0), pt(0), pt(7), pt(0), pt(0), pt(0), pt(0), pt(0)];
    // Whichever bucket it lands in, the spike must appear in the output.
    expect(Math.max(...decimate(spike, 3).map((p) => p.max))).toBe(7);
  });

  it("leaves a short take alone", () => {
    expect(decimate([pt(1), pt(2)], 100)).toEqual([pt(1), pt(2)]);
    expect(decimate([], 100)).toEqual([]);
    expect(decimate(ramp, 0)).toEqual([]);
  });
});

describe("GrowingDecimate", () => {
  const take = (n: number) =>
    Array.from({ length: n }, (_, i) => pt((i * 37) % 101));

  it("draws a short take point for point, as decimate does", () => {
    const d = new GrowingDecimate();
    const pts = take(50);
    expect(d.of(pts, 100)).toEqual(decimate(pts, 100));
  });

  it("stays within the width and keeps every extreme as the take grows", () => {
    const d = new GrowingDecimate();
    const pts: EnvPoint[] = [];
    for (let n = 0; n < 5000; n += 37) {
      for (const p of take(37)) pts.push(p);
      const out = d.of(pts, 120);
      expect(out.length).toBeLessThanOrEqual(120);
      expect(out.length).toBeGreaterThanOrEqual(Math.min(pts.length, 60));
      expect(Math.max(...out.map((p) => p.max))).toBe(100);
      expect(Math.min(...out.map((p) => p.min))).toBe(-100);
    }
  });

  it("matches a fresh fold of the same points, however they arrived", () => {
    const pts = take(3000);
    const grown = new GrowingDecimate();
    const live: EnvPoint[] = [];
    for (const p of pts) {
      live.push(p);
      if (live.length % 13 === 0) grown.of(live, 90);
    }
    const once = new GrowingDecimate().of([...pts], 90);
    expect(grown.of(live, 90)).toEqual(once);
  });

  it("folds only what is new: a paint with nothing appended reads no point", () => {
    const pts = take(1000);
    let reads = 0;
    const spy = new Proxy(pts, {
      get(t, k, r) {
        if (typeof k === "string" && /^\d+$/.test(k)) reads++;
        return Reflect.get(t, k, r);
      },
    });
    const first = new GrowingDecimate();
    first.of(spy, 64);
    reads = 0;
    first.of(spy, 64);
    expect(reads).toBe(0);
    spy.push(pt(1));
    reads = 0;
    first.of(spy, 64);
    expect(reads).toBe(1);
  });

  it("starts afresh on a new take, a shorter one, or a new width", () => {
    const d = new GrowingDecimate();
    d.of(take(500), 50);
    const next = [pt(3), pt(4)];
    expect(d.of(next, 50)).toEqual([pt(3), pt(4)]);
    expect(d.of(next, 1)).toEqual([pt(4)]);
  });
});
