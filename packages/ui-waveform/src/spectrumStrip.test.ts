import { describe, expect, it } from "vitest";
import { tilesFor } from "./spectrumStrip";

// A view slides over the strip; the tiles it needs are the ones its two edges fall in, and those between.

describe("tilesFor", () => {
  it("is one tile when the view sits inside it", () => {
    expect(tilesFor(10, 100, 512)).toEqual([0]);
  });
  it("is two when the view straddles an edge", () => {
    expect(tilesFor(480, 100, 512)).toEqual([0, 1]);
  });
  it("counts negative tiles before the strip's start, where the band draws empty", () => {
    expect(tilesFor(-300, 600, 512)).toEqual([-1, 0]);
  });
  it("does not ask for the next tile when the view ends exactly on its edge", () => {
    expect(tilesFor(0, 512, 512)).toEqual([0]);
  });
  it("is nothing for an empty view", () => {
    expect(tilesFor(0, 0, 512)).toEqual([]);
  });
});
