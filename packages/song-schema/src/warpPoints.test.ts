import { describe, expect, it } from "vitest";
import {
  removeWarpPoint,
  retimeWarpMarkers,
  seedWarp,
  setWarpPoint,
  type WarpMarker,
} from "./warpPoints";

// A clip's stretch map, rising through both axes, and moving a point leaves its NEIGHBOURS put — docs/warpPoints.md.

const MAP: WarpMarker[] = [
  [0, 0],
  [4, 2],
  [8, 4],
];

describe("moving a point", () => {
  it("changes its beat and nothing else", () => {
    expect(setWarpPoint(MAP, 2, 5)).toEqual([
      [0, 0],
      [5, 2],
      [8, 4],
    ]);
  });

  it("leaves the source second alone — the moment is the same moment", () => {
    // The handle moves along the TIMELINE; changing which instant it pins would be scrubbing.
    expect(setWarpPoint(MAP, 2, 5)[1][1]).toBe(2);
  });

  it("finds the point within a millisecond, so a round trip still lands on it", () => {
    expect(setWarpPoint(MAP, 2.0005, 5)).toHaveLength(3);
  });
});

describe("placing a new one", () => {
  it("inserts it in source order", () => {
    expect(setWarpPoint(MAP, 3, 6)).toEqual([
      [0, 0],
      [4, 2],
      [6, 3],
      [8, 4],
    ]);
  });

  it("appends past the last point", () => {
    expect(setWarpPoint(MAP, 5, 10)).toHaveLength(4);
    expect(setWarpPoint(MAP, 5, 10)[3]).toEqual([10, 5]);
  });
});

describe("the order it refuses to break", () => {
  it("refuses a beat that would pass its neighbour", () => {
    // Not a slower clip: a span that plays backwards.
    expect(() => setWarpPoint(MAP, 2, 9)).toThrow(/between its neighbours/);
    expect(() => setWarpPoint(MAP, 2, 0)).toThrow(/between its neighbours/);
  });

  it("names the neighbour it has to stay behind, rather than clamping", () => {
    // A handle that stops moving says more than one that lands somewhere it was not dropped.
    expect(() => setWarpPoint(MAP, 2, 9)).toThrow(
      /beat 9 is not after beat 8|beat 8/,
    );
  });

  it("refuses a new point whose beat does not fit where its second puts it", () => {
    expect(() => setWarpPoint(MAP, 3, 1)).toThrow(/between its neighbours/);
  });
});

describe("removing one", () => {
  it("drops it", () => {
    expect(removeWarpPoint(MAP, 2)).toEqual([
      [0, 0],
      [8, 4],
    ]);
  });

  it("refuses to go below two, which cannot be applied at all", () => {
    // One point says where a single moment lands and nothing about the rate anywhere.
    expect(() =>
      removeWarpPoint(
        [
          [0, 0],
          [8, 4],
        ],
        0,
      ),
    ).toThrow(/needs two points/);
  });

  it("refuses a point that is not there", () => {
    expect(() => removeWarpPoint(MAP, 3)).toThrow(/no warp point/);
  });
});

describe("seeding a clip that has none", () => {
  it("anchors the start and the end", () => {
    expect(seedWarp(8, 4)).toEqual([
      [0, 0],
      [8, 4],
    ]);
  });

  it("is an IDENTITY map, which the engine skips — so seeding changes no sound", () => {
    // A two-point warp of ratio 1 is skipped, so the THIRD point is what makes it a warp (docs/warpPoints.md).
    const seeded = seedWarp(8, 4);
    expect(seeded).toHaveLength(2);
    expect(setWarpPoint(seeded, 2, 3)).toHaveLength(3);
  });

  it("refuses a clip with no length to stretch", () => {
    expect(() => seedWarp(0, 4)).toThrow();
    expect(() => seedWarp(8, 0)).toThrow();
  });
});

// The bug this exists for: a bounce that adds a two-second tail plays the take 11% slow (docs/warpPoints.md).
describe("retiming a map onto a bounced file", () => {
  // 32.834841 beats over 17.92 s is 109.93 bpm — the real take.
  const TAKE: WarpMarker[] = [
    [0, 0],
    [12, 6.555542],
    [32.834841, 17.92],
  ];
  const bpm = (m: WarpMarker[]) =>
    ((m[m.length - 1][0] - m[0][0]) / (m[m.length - 1][1] - m[0][1])) * 60;

  it("follows a file the render made LONGER, keeping the take's tempo", () => {
    const out = retimeWarpMarkers(TAKE, 19.92);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out[out.length - 1][1]).toBe(19.92);
    // The whole point: the engine reads the same tempo off the longer file, to the six decimals written.
    expect(Math.abs(bpm(out) - bpm(TAKE)) / bpm(TAKE)).toBeLessThan(1e-7);
    // …and every point that was already there is untouched — the material did not move.
    expect(out.slice(0, 3)).toEqual(TAKE);
  });

  it("drops what a SHORTER file no longer holds, and lands on its end", () => {
    const out = retimeWarpMarkers(TAKE, 10);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out[out.length - 1][1]).toBe(10);
    expect(out.some((m) => m[1] > 10)).toBe(false);
    // Not the same tempo to the last decimal, since the map is PIECEWISE — only the appended segment is exact.
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const want = (TAKE[2][0] - TAKE[0][0]) / (TAKE[2][1] - TAKE[0][1]);
    expect(Math.abs((b[0] - a[0]) / (b[1] - a[1]) - want) / want).toBeLessThan(
      1e-7,
    );
    expect(Math.abs(bpm(out) - bpm(TAKE)) / bpm(TAKE)).toBeLessThan(0.001);
  });

  it("keeps two points even when almost nothing is left", () => {
    const out = retimeWarpMarkers(TAKE, 0.5);
    expect(out).toHaveLength(2);
    expect(out?.[1][1]).toBe(0.5);
  });

  // Six decimals, the precision an importer writes — the map goes in a file a person reads.
  it("writes a point at the precision the others are written at", () => {
    const out = retimeWarpMarkers(TAKE, 19.92);
    expect(out?.[out.length - 1]).toEqual([36.499444, 19.92]);
    for (const m of out ?? [])
      for (const v of m) expect(String(v)).not.toMatch(/\.\d{7,}/);
  });

  // A bounce that changed no duration must leave the clip file byte-identical (docs/warpPoints.md).
  it("says nothing when the file is the length the map already claims", () => {
    expect(retimeWarpMarkers(TAKE, 17.92)).toBeNull();
    expect(retimeWarpMarkers(TAKE, 17.9205)).toBeNull(); // a millisecond is the same end
  });

  it("says nothing about a map it cannot read", () => {
    expect(retimeWarpMarkers([[0, 0]], 10)).toBeNull();
    expect(retimeWarpMarkers(TAKE, 0)).toBeNull();
    expect(
      retimeWarpMarkers(
        [
          [0, 0],
          [0, 4],
        ],
        10,
      ),
    ).toBeNull();
  });

  it("stays monotonic, which is the map's one rule", () => {
    for (const secs of [1, 5, 17.9, 19.92, 60]) {
      const out = retimeWarpMarkers(TAKE, secs) ?? TAKE;
      for (let i = 1; i < out.length; i++) {
        expect(out[i][1]).toBeGreaterThan(out[i - 1][1]);
        expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
      }
    }
  });
});
