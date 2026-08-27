// `decimate` alone — the drawing half, split from the accumulation when that moved to
// @studio/engine-browser so it could outlive the card (packages/song/docs/recorderNode.md).

import { describe, expect, it } from "vitest";
import { decimate, type EnvPoint } from "./decimate";

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
