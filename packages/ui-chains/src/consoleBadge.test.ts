// The project's CONSOLE has no node of its own: the nodes its halves follow wear its name. Pinned
// here: the strip and the MIX sum are marked, nothing else is, and no console marks nothing.
// See packages/song/docs/console.md.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const graph = (console?: WebGraph["console"]): WebGraph => ({
  chains: {
    lead: {
      from: "gt_lead",
      use: [{ module: "amp" }, { module: "strip" }],
      out: [{ to: "MIX", gain: 1 }],
    },
  },
  tracks: ["gt_lead"],
  ...(console ? { console } : {}),
  warnings: [],
});

const marked = (g: WebGraph) =>
  buildGraph(g)
    .nodes.filter((n) => n.console)
    .map((n) => [n.module ?? n.label, n.console]);

describe("the console badge", () => {
  it("marks the strip and the MIX sum, and nothing else", () => {
    const g = graph({
      system: "@st0/console/console-6",
      label: "Console 6",
      nodes: ["strip", "MIX"],
    });
    expect(marked(g)).toEqual([
      ["strip", "Console 6"],
      ["MIX", "Console 6"],
    ]);
  });

  it("marks nothing when the project runs no console", () => {
    expect(marked(graph())).toEqual([]);
  });
});
