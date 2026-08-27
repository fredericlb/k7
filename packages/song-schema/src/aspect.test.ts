// The frame's shape. `aspectOf` is the half worth pinning: it decides which row the RENDER card
// ticks, and a ratio match rather than a size match is what lets an old [1280, 720] project tick
// the same row as a new one.

import { describe, expect, it } from "vitest";
import { ASPECTS, aspectOf, aspectSize } from "./aspect";

describe("aspectSize", () => {
  it("answers the two on offer", () => {
    expect(aspectSize("16:9")).toEqual({ name: "16:9", w: 1920, h: 1080 });
    expect(aspectSize("9:16")).toEqual({ name: "9:16", w: 1080, h: 1920 });
  });

  it("REFUSES one it does not know, rather than guessing a size", () => {
    expect(aspectSize("4:3")).toBeNull();
    expect(aspectSize("")).toBeNull();
    expect(aspectSize("16x9")).toBeNull();
  });

  it("forgives the whitespace a command line brings", () => {
    expect(aspectSize(" 16:9 ")?.w).toBe(1920);
  });
});

describe("aspectOf", () => {
  it("reads a viewport by its RATIO, not its size", () => {
    expect(aspectOf(1920, 1080)?.name).toBe("16:9");
    expect(aspectOf(1280, 720)?.name).toBe("16:9");
    expect(aspectOf(1080, 1920)?.name).toBe("9:16");
    expect(aspectOf(720, 1280)?.name).toBe("9:16");
  });

  it("says nothing for a shape that is on neither list", () => {
    // A 4:3 or a square viewport is legal to have authored; the card shows no row ticked rather
    // than ticking the nearest and lying about it.
    expect(aspectOf(640, 480)).toBeNull();
    expect(aspectOf(1000, 1000)).toBeNull();
  });

  it("answers nothing for a viewport that is not one", () => {
    expect(aspectOf(0, 1080)).toBeNull();
    expect(aspectOf(1920, 0)).toBeNull();
    expect(aspectOf(-1, -1)).toBeNull();
  });

  it("round-trips every name on the list", () => {
    for (const a of ASPECTS) expect(aspectOf(a.w, a.h)?.name).toBe(a.name);
  });
});
