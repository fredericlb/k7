import { describe, expect, it } from "vitest";
import { playheadPlacement } from "./playhead";

// The played canvas shows exactly [0, x], the region the single canvas used to repaint purple.

describe("playheadPlacement", () => {
  it("clips the played canvas to the left of the playhead", () => {
    const p = playheadPlacement(300, 800);
    expect(p.clipPath).toBe("inset(0 500px 0 0)");
    expect(p.playedVisible).toBe(true);
    expect(p.lineTransform).toBe("translateX(299px)");
  });

  it("hides the played side before the material starts", () => {
    expect(playheadPlacement(0, 800).playedVisible).toBe(false);
    expect(playheadPlacement(-40, 800).playedVisible).toBe(false);
  });

  it("never asks for a negative or oversized inset", () => {
    expect(playheadPlacement(900, 800).clipPath).toBe("inset(0 0px 0 0)");
    expect(playheadPlacement(-40, 800).clipPath).toBe("inset(0 800px 0 0)");
  });
});
