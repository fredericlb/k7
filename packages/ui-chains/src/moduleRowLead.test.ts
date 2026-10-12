// A subchain's row begins at a node that only says where the signal comes from: drawn first,
// cabled into the first card, and acted on by nothing — a pass-through, not a module.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { moduleRow } from "./graph";

const graph: WebGraph = {
  chains: {
    tap: {
      use: [{ module: "eq" }, { module: "verb" }],
      out: [{ to: "MIX", gain: 1 }],
    },
  },
  tracks: [],
  warnings: [],
};
const lead = { id: "tap-input", label: "input", sub: "the song comes in here" };

describe("moduleRow's lead", () => {
  it("draws the input first, as a pass-through node, and cables it into the first card", () => {
    const laid = moduleRow(graph, ["eq", "verb"], { links: true, lead });
    expect(laid.nodes.map((n) => n.label)).toEqual(["input", "eq", "verb"]);
    const input = laid.nodes[0];
    expect(input.kind).toBe("chain");
    expect(input.x).toBeLessThan(laid.nodes[1].x);
    const first = laid.nodes[1];
    expect(
      laid.edges.some((e) => e.source === "tap-input" && e.target === first.id),
    ).toBe(true);
  });

  it("draws no input over an empty chain, and none without being asked", () => {
    expect(moduleRow(graph, [], { links: true, lead }).nodes).toEqual([]);
    expect(
      moduleRow(graph, ["eq"], { links: true }).nodes.map((n) => n.label),
    ).toEqual(["eq"]);
  });
});
