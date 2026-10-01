// A biquad's inputs as the engine reads them: two for a pass filter, three for a peak or a shelf.

import { describe, expect, it } from "vitest";
import { graph } from "./index";

describe("biquad", () => {
  it("emits a pass filter with frequency and Q only", () => {
    const g = graph((b) => b.biquad("lowpass", 1000, 0.7));
    expect(g.nodes).toEqual([
      { type: "biquad", in: [1000, 0.7], mode: "lowpass" },
    ]);
  });

  it("emits a peak and the shelves with their gain in dB as the third input", () => {
    const g = graph((b) => {
      const gain = b.param("Gain", { min: -18, max: 18, default: 0 });
      b.biquad("peak", 1000, 1, gain);
      b.biquad("lowshelf", 100, 0.7, -6);
      b.biquad("highshelf", 8000, 0.7, 3);
    });
    expect(g.nodes.map((n) => [n.mode, n.in])).toEqual([
      ["peak", [1000, 1, "Gain"]],
      ["lowshelf", [100, 0.7, -6]],
      ["highshelf", [8000, 0.7, 3]],
    ]);
  });
});
