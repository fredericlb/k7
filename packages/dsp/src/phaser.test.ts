// The phaser and chorus graphs: Tracktion's knobs by name, range and default, so a node's values and its
// curves carry over to the graph — and the shapes that make each effect what it is.

import { describe, expect, it } from "vitest";
import { chorus } from "./chorus";
import { phaser } from "./phaser";

const spec = (g: ReturnType<typeof phaser>) =>
  g.params.map((p) => [p.name, p.min, p.max, p.default]);

describe("the phaser graph", () => {
  const g = phaser();

  it("has Tracktion's three knobs, with its ranges and defaults", () => {
    expect(spec(g)).toEqual([
      ["Depth", 0, 10, 5],
      ["Rate", 0, 10, 0.4],
      ["Feedback", 0, 1, 0.7],
    ]);
  });

  it("is four all-pass stages, the last writing the wire the input reads back", () => {
    const stages = g.nodes.filter((n) => n.type === "aallpass");
    expect(stages).toHaveLength(4);
    expect(stages[3].out).toBe("fb");
    // The feedback is read BEFORE its writer, which is what makes it the previous sample.
    const read = g.nodes.findIndex((n) => n.in?.includes("fb"));
    expect(read).toBeLessThan(g.nodes.indexOf(stages[3]));
  });

  it("sweeps every stage from the same 100 Hz base, moved by the same octave wire", () => {
    const stages = g.nodes.filter((n) => n.type === "aallpass");
    expect(new Set(stages.map((n) => n.k?.[0]))).toEqual(new Set([100]));
    expect(new Set(stages.map((n) => n.in?.[1])).size).toBe(1);
  });
});

describe("the chorus graph", () => {
  const g = chorus();

  it("has Tracktion's knobs but Mix, which is the engine's own @mix stage", () => {
    expect(spec(g)).toEqual([
      ["Depth", 0, 20, 3],
      ["Speed", 0, 10, 1],
      ["Width", 0, 1, 0.5],
    ]);
  });

  it("runs the right channel's LFO ahead by a share of Width, which is the stereo spread", () => {
    const lfo = g.nodes.find((n) => n.type === "alfo");
    expect(lfo?.k).toHaveLength(2);
    expect(lfo?.k?.[0]).toBe("Speed");
  });

  it("is all wet, leaving the blend to the module's `mix:`", () => {
    expect(g.nodes.find((n) => n.type === "mix")).toBeUndefined();
  });
});
