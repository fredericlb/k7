import { describe, expect, it } from "vitest";
import {
  removeWarpPoint,
  retimeWarpMarkers,
  seedWarp,
  setWarpPoint,
  type WarpMarker,
} from "./warpPoints";

// A clip's stretch map: `[timelineBeat, sourceSecond]`, rising through both. Moving one point
// leaves its NEIGHBOURS where they are — only the two segments touching it change their rate. The
// alternative, redistributing outward, sounds smoother and means one drag re-times material at the
// far end of the clip, which nobody can see from the handle they are holding.

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
    // The handle moves along the TIMELINE. Which instant of the file it pins does not change,
    // or the drag would be scrubbing rather than stretching.
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
    // A two-point warp of ratio 1 means "the source already runs at the project tempo", and
    // entering Tracktion's auto-tempo path for it is both pointless and a bug it has (see
    // applyClipWarp). The third point is what makes it a warp.
    const seeded = seedWarp(8, 4);
    expect(seeded).toHaveLength(2);
    expect(setWarpPoint(seeded, 2, 3)).toHaveLength(3);
  });

  it("refuses a clip with no length to stretch", () => {
    expect(() => seedWarp(0, 4)).toThrow();
    expect(() => seedWarp(8, 0)).toThrow();
  });
});

/**
 * The bug this exists for, from `01.danse.l8`: `clip process … normalize` bounced a 17.920 s take
 * through a chain and wrote a 19.920 s file — the render adds a two-second tail for reverb and
 * release. The map still ended at 17.92, and the engine reads the map's beat span as the length of
 * the WHOLE source, so the take's 110 bpm became 98.9, everything played 11% slow, and the phrase
 * was cut before its end by the window cap.
 */
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
    // The whole point: the engine now reads the same tempo off the longer file.
    expect(bpm(out)).toBeCloseTo(bpm(TAKE), 6);
    // …and every point that was already there is untouched — the material did not move.
    expect(out.slice(0, 3)).toEqual(TAKE);
  });

  it("drops what a SHORTER file no longer holds, and lands on its end", () => {
    const out = retimeWarpMarkers(TAKE, 10);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out[out.length - 1][1]).toBe(10);
    expect(out.some((m) => m[1] > 10)).toBe(false);
    // Not the same tempo to the last decimal, and it cannot be: the map is PIECEWISE, so a
    // prefix carries its own local rate. What is exact is the segment this appended — it
    // continues at the map's overall rate — and the tempo the engine reads off the whole is
    // then within a tenth of a percent, which is inaudible and honest.
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    expect((b[0] - a[0]) / (b[1] - a[1])).toBeCloseTo(
      (TAKE[2][0] - TAKE[0][0]) / (TAKE[2][1] - TAKE[0][1]),
      9,
    );
    expect(Math.abs(bpm(out) - bpm(TAKE)) / bpm(TAKE)).toBeLessThan(0.001);
  });

  it("keeps two points even when almost nothing is left", () => {
    const out = retimeWarpMarkers(TAKE, 0.5);
    expect(out).toHaveLength(2);
    expect(out?.[1][1]).toBe(0.5);
  });

  // Nothing to say means nothing written: a bounce that changed no duration must leave the clip
  // file byte-identical, or every run of every chain would churn every map it touched.
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
