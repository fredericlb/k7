// What a tremolo can get silently wrong: modulating at block rate (a stutter), and a depth
// control that is not unity at zero (a module you cannot leave in a chain switched off).

import { describe, expect, it } from "vitest";
import { tremolo } from "./tremolo";

describe("the tremolo graph", () => {
  const g = tremolo();
  const node = (t: string) => g.nodes.find((n) => n.type === t);

  it("takes a rate and a depth, and nothing else", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Rate", "Depth"]);
  });

  it("modulates at SAMPLE rate — the LFO is an audio wire, not a block-rate scalar", () => {
    // `alfo` is the sample-rate oscillator; `gain` would be the block-rate one this must never be.
    expect(node("alfo")).toBeTruthy();
    expect(node("gain")).toBeUndefined();
  });

  it("is unity at depth 0, so a module left in a chain switched off is silent about it", () => {
    // The floor is `1 - depth`: at 0 the modulated term vanishes and the constant is 1.
    expect(g.params.find((p) => p.name === "Depth")?.min).toBe(0);
    expect(node("sub")?.in).toEqual([1, "Depth"]);
  });

  it("never inverts the signal — the LFO is offset to 0..1 before it scales anything", () => {
    // A bipolar gain would ring-modulate: audible as an octave up, and not what the word means.
    const offset = g.nodes.find(
      (n) => n.type === "aadd" && n.k?.includes(1) && n.in?.[0] === "n1",
    );
    expect(offset).toBeTruthy();
    // …and halved right after, so the range is 0..1 rather than 0..2.
    expect(g.nodes.find((n) => n.in?.[0] === offset?.out)?.k).toEqual([0.5]);
  });
});
