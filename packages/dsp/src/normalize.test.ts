// The first cold module. What is worth pinning is not the multiplication — the engine does that
// — but the two things this description can get silently wrong: that the measured peak arrives as
// a PARAMETER (there is nowhere else for a fact measured outside the graph to come from), and
// that the gain is bounded, since the arithmetic has a degenerate case that is very loud.

import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET_DB, normalize } from "./normalize";

describe("the normalisation graph", () => {
  const g = normalize();
  const node = (t: string) => g.nodes.find((n) => n.type === t);

  it("takes the target and the MEASURED peak as its two controls", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Target", "Peak"]);
    expect(g.params.find((p) => p.name === "Target")?.default).toBe(
      DEFAULT_TARGET_DB,
    );
  });

  it("defaults Peak to 0 dBFS, so an unmeasured file is attenuated and never boosted", () => {
    // With no cold pass run it must not be able to make anything louder: it has no idea by how much.
    expect(g.params.find((p) => p.name === "Peak")?.default).toBe(0);
  });

  it("applies a gain and nothing else — the measuring is not in the graph", () => {
    // If this graph ever grows an `envelope` it has become a compressor rather than a normaliser.
    expect(node("gain")).toBeTruthy();
    expect(node("envelope")).toBeUndefined();
    expect(node("biquad")).toBeUndefined();
  });

  it("bounds the gain, so near-silence cannot ask for +99 dB", () => {
    const clamp = node("clamp");
    expect(clamp).toBeTruthy();
    // lo, hi — the two literals after the value being clamped.
    expect(clamp?.in?.slice(1)).toEqual([-60, 30]);
  });

  it("converts to linear AFTER clamping, or the bound would be meaningless", () => {
    // fromdb of an unclamped difference is the runaway this exists to prevent; order is the fix.
    const clampAt = g.nodes.findIndex((n) => n.type === "clamp");
    const fromdbAt = g.nodes.findIndex((n) => n.type === "fromdb");
    expect(clampAt).toBeGreaterThanOrEqual(0);
    expect(fromdbAt).toBeGreaterThan(clampAt);
  });
});
