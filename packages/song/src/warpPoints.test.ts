import { describe, expect, it } from "vitest";
import {
  removeWarpPoint,
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
