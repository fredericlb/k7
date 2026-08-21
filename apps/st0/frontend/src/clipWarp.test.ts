// The two conversions between the picture and the command. Nothing mounts a component in this
// app, so this is the only place the warp gesture can be held to anything — and it is the place
// worth holding: a conversion taken backwards puts a stretch point somewhere the drawing never
// showed, the picture is rebuilt from the file, and it is simply right about the wrong point.

import { describe, expect, it } from "vitest";
import { toClipBeat, toFileSec, warpLine } from "./clipWarp";

// The producer's mapping, as `WebWaveform.sourceMap` sends it: a clip trimmed to start 2 s into
// its file, played at half speed — so one source second occupies two of the picture.
const MAP = { inPoint: 2, stretch: 0.5 };

describe("toFileSec", () => {
  it("is the exact inverse of the producer's `(file − inPoint) × stretch`", () => {
    const toDisplay = (f: number) => (f - MAP.inPoint) * MAP.stretch;
    for (const file of [2, 3.5, 10, 61.25])
      expect(toFileSec(toDisplay(file), MAP)).toBeCloseTo(file, 9);
  });

  it("puts the picture's zero at the clip's in-point, not at the file's head", () => {
    // The bug this guards: reading `offset` alone drew every trimmed clip from the file's start.
    expect(toFileSec(0, MAP)).toBe(2);
  });

  it("is the identity for an untrimmed, unwarped clip", () => {
    expect(toFileSec(4.2, { inPoint: 0, stretch: 1 })).toBeCloseTo(4.2, 9);
  });

  it("falls back to the file's own rate rather than dividing by zero", () => {
    // A stretch of 0 is a picture of nothing; Infinity would reach the command as `Infinity`.
    expect(Number.isFinite(toFileSec(3, { inPoint: 0, stretch: 0 }))).toBe(
      true,
    );
  });
});

describe("toClipBeat", () => {
  it("reads a warp mark's `target = (beat × 60) / tempo` backwards", () => {
    expect(toClipBeat((8 * 60) / 120, 120)).toBeCloseTo(8, 9);
  });

  it("counts from the clip's start, which is where the region's zero is", () => {
    expect(toClipBeat(0, 120)).toBe(0);
  });
});

describe("warpLine", () => {
  it("names the SOURCE second and the beat, not the two seconds it was handed", () => {
    // 4 display seconds in = file second 10 (4 / 0.5 + 2); 2 display seconds out = beat 4 at 120.
    expect(warpLine("break", 4, 2, MAP, 120)).toBe(
      "clip warp break 10.0000 4.000",
    );
  });

  it("a double-click pins a moment to where it already is — the same second twice", () => {
    // Which is why placing a point changes no sound: what it makes is a handle.
    expect(warpLine("break", 4, 4, MAP, 120)).toBe(
      "clip warp break 10.0000 8.000",
    );
  });

  it("never emits a negative second or beat", () => {
    // `xToTime` is clamped, but a clip whose in-point is past the pointer is not a refusal upstream.
    expect(warpLine("b", -5, -5, { inPoint: 0, stretch: 1 }, 120)).toBe(
      "clip warp b 0.0000 0.000",
    );
  });
});

// There was a `warpAt` here — nearest mark to a click, for hit-testing the canvas. The drag ended
// up on DOM handles instead (the same layer the window's edges use, for the same reason), so
// nothing ever called it. Removed rather than left: knip counts an export its own test uses as
// live, so this one would not have been caught by anything but noticing.
