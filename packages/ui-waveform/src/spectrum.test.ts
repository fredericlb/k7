import { describe, expect, it } from "vitest";
import { columnsOf, interpolated, mirroredYs, smoothColumns } from "./spectrum";

// Ten buckets of 100 ms: one second of material.
const env = (over = {}) => ({
  intervalMs: 100,
  samples: new Array(10).fill(0.1),
  peak: [0.2, 0.9, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
  ...over,
});

describe("columnsOf", () => {
  it("takes the MAX of the buckets a column covers, so a hit survives a zoom-out", () => {
    const cols = columnsOf(env(), 5, 0, 1);
    expect(cols.map((c) => c?.amp)).toEqual([0.9, 0.2, 0.2, 0.2, 0.2]);
  });

  it("reads the peak when there is one and the RMS otherwise", () => {
    const cols = columnsOf(env({ peak: undefined }), 2, 0, 1);
    expect(cols.map((c) => c?.amp)).toEqual([0.1, 0.1]);
  });

  it("leaves a column past the material empty rather than silent", () => {
    const cols = columnsOf(env(), 4, 0.5, 1);
    expect(cols[0]).not.toBeNull();
    expect(cols[3]).toBeNull();
  });

  it("carries each band's max, and none at all for a file analysed without them", () => {
    const low = new Array(10).fill(0.1);
    low[3] = 0.8;
    const banded = columnsOf(
      env({ low, mid: new Array(10).fill(0.2), high: new Array(10).fill(0.3) }),
      2,
      0,
      1,
    );
    expect(banded[0]?.bands).toEqual({ low: 0.8, mid: 0.2, high: 0.3 });
    expect(columnsOf(env(), 2, 0, 1)[0]?.bands).toBeNull();
  });
});

describe("mirroredYs", () => {
  it("puts an amplitude the same distance above and below the middle", () => {
    const [top, bottom] = mirroredYs(0.5, 100);
    expect(bottom - 50.5).toBeCloseTo(50.5 - top);
  });
});

describe("interpolated", () => {
  it("slopes between two bucket centres instead of stepping", () => {
    expect(interpolated({ amps: [0, 1] }, 0.5)?.amp).toBeCloseTo(0.5);
    expect(interpolated({ amps: [0, 1] }, 0)?.amp).toBe(0);
  });

  it("is empty past either edge of the material", () => {
    expect(interpolated({ amps: [1, 1] }, -1)).toBeNull();
    expect(interpolated({ amps: [1, 1] }, 2)).toBeNull();
  });
});

describe("smoothColumns", () => {
  it("spreads a lone spike over its neighbours and keeps empty columns empty", () => {
    const flat = { amp: 0, bands: null };
    const out = smoothColumns([
      null,
      flat,
      flat,
      { amp: 1, bands: null },
      flat,
      flat,
    ]);
    expect(out[0]).toBeNull();
    expect(out[3]?.amp).toBeLessThan(1);
    expect(out[2]?.amp).toBeGreaterThan(0);
  });

  it("leaves an even run unchanged", () => {
    const c = { amp: 0.4, bands: { low: 1, mid: 0, high: 0 } };
    const out = smoothColumns([c, c, c, c, c]);
    expect(out[2]?.amp).toBeCloseTo(0.4);
  });
});
