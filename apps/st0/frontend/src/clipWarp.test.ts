// The two conversions between the picture and the command. Nothing mounts a component in this
// app, so this is the only place the warp gesture can be held to anything — and it is the place
// worth holding: a conversion taken backwards puts a stretch point somewhere the drawing never
// showed, the picture is rebuilt from the file, and it is simply right about the wrong point.
//
// That is not hypothetical. `toFileSec` read the OVERALL ratio, which inverts the drawing only
// while the map is a straight line — true with two markers, false from the third. So placing a
// second point on a clip bent the map instead of pinning a moment where it already sat, and the
// waveform moved under a gesture that was supposed to change nothing.

import { describe, expect, it } from "vitest";
import { toClipBeat, toFileSec, warpLine } from "./clipWarp";

// A clip trimmed to start 2 s into its file, played at half speed — one source second occupies
// two of the picture. `zeroBeat` 0: an untrimmed map, which is where the omission hid.
const FLAT = { inPoint: 2, stretch: 0.5, zeroBeat: 0 };

/**
 * A BENT map, in the two spaces the browser gets it: `orig` display seconds, `src` file seconds.
 *
 * The first source second is drawn across four display seconds, the next three across four —
 * so the two halves run at different rates and no single ratio describes both.
 */
const BENT = [
  { orig: 0, src: 0 },
  { orig: 4, src: 1 },
  { orig: 8, src: 4 },
];

describe("toFileSec", () => {
  it("is the exact inverse of the producer's ratio when the map is straight", () => {
    const toDisplay = (f: number) => (f - FLAT.inPoint) * FLAT.stretch;
    for (const file of [2, 3.5, 10, 61.25])
      expect(toFileSec(toDisplay(file), FLAT)).toBeCloseTo(file, 9);
  });

  it("puts the picture's zero at the clip's in-point, not at the file's head", () => {
    expect(toFileSec(0, FLAT)).toBe(2);
  });

  it("follows the map SEGMENT BY SEGMENT — the bug, pinned", () => {
    // Half-way through the first segment is source second 0.5, not the 1 an overall ratio
    // (8 display over 4 source = 2) would answer.
    expect(
      toFileSec(2, { inPoint: 0, stretch: 2, zeroBeat: 0 }, BENT),
    ).toBeCloseTo(0.5, 9);
    expect(
      toFileSec(6, { inPoint: 0, stretch: 2, zeroBeat: 0 }, BENT),
    ).toBeCloseTo(2.5, 9);
  });

  it("lands each mark on its own source second, exactly", () => {
    for (const p of BENT)
      expect(
        toFileSec(p.orig, { inPoint: 0, stretch: 2, zeroBeat: 0 }, BENT),
      ).toBeCloseTo(p.src, 9);
  });

  it("takes the marks in any order — the wire does not promise one", () => {
    const shuffled = [BENT[2], BENT[0], BENT[1]];
    expect(
      toFileSec(2, { inPoint: 0, stretch: 2, zeroBeat: 0 }, shuffled),
    ).toBeCloseTo(0.5, 9);
  });

  it("falls back to the ratio outside the marks, and with fewer than two", () => {
    // A map of one point states no rate; a clip with none is the ordinary case.
    expect(
      toFileSec(3, { inPoint: 0, stretch: 1, zeroBeat: 0 }, [BENT[0]]),
    ).toBeCloseTo(3, 9);
    expect(
      Number.isFinite(toFileSec(3, { inPoint: 0, stretch: 0, zeroBeat: 0 })),
    ).toBe(true);
  });
});

describe("toClipBeat", () => {
  it("reads a mark's `target = (beat − zeroBeat) × 60 / tempo` backwards", () => {
    expect(toClipBeat((8 * 60) / 120, 120, FLAT)).toBeCloseTo(8, 9);
  });

  it("adds zeroBeat back — the map counts from the FILE's start, the region from the clip's", () => {
    // Absent, every beat on a TRIMMED clip was short by exactly this, silently.
    const trimmed = { inPoint: 2, stretch: 1, zeroBeat: 6 };
    expect(toClipBeat(0, 120, trimmed)).toBe(6);
    expect(toClipBeat((2 * 60) / 120, 120, trimmed)).toBeCloseTo(8, 9);
  });
});

describe("warpLine", () => {
  it("names the SOURCE second and the beat, not the two seconds it was handed", () => {
    // 4 display seconds in = file second 10 (4 / 0.5 + 2); 2 display seconds out = beat 4 at 120.
    expect(warpLine("break", 4, 2, FLAT, 120)).toBe(
      "clip warp break 10.0000 4.000",
    );
  });

  it("a double-click pins a moment to where it already is — the same second twice", () => {
    expect(warpLine("break", 4, 4, FLAT, 120)).toBe(
      "clip warp break 10.0000 8.000",
    );
  });

  it("re-states an EXISTING point unchanged, so placing one beside it bends nothing", () => {
    // The whole of the reported bug, as one assertion: double-clicking on a mark of a bent map
    // must name that mark's own source second. Read through the ratio it named another, and the
    // map acquired a point it never had.
    const map = { inPoint: 0, stretch: 2, zeroBeat: 0 };
    expect(warpLine("b", BENT[1].orig, BENT[1].orig, map, 120, BENT)).toBe(
      "clip warp b 1.0000 8.000",
    );
  });

  it("never emits a negative second or beat", () => {
    expect(
      warpLine("b", -5, -5, { inPoint: 0, stretch: 1, zeroBeat: 0 }, 120),
    ).toBe("clip warp b 0.0000 0.000");
  });
});
