// tapFeeds.test.ts — a rack's tap routed to a subchain is drawn as a cable from an output of the rack's own,
// named after the tap, to the run it feeds; a feed naming no node on the graph draws nothing.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const graph = (tapFeeds?: WebGraph["tapFeeds"]): WebGraph => ({
  chains: {
    kit: {
      from: "kit",
      use: [{ module: "drums" }],
      out: [{ to: "MIX", gain: 1 }],
    },
    "snare-verb": {
      use: [{ module: "snare-verb" }],
      out: [{ to: "MIX", gain: 1 }],
    },
  },
  tracks: ["kit"],
  warnings: [],
  ...(tapFeeds ? { tapFeeds } : {}),
});

describe("a tap routed to a subchain", () => {
  it("is a cable from the tap's own output, labelled with its name", () => {
    const { nodes, edges } = buildGraph(
      graph([{ node: "drums", tap: "Snare", to: "snare-verb" }]),
    );
    const cable = edges.find((e) => e.sourcePort === "Snare");
    expect(cable?.source).toBe("mod:drums");
    expect(cable?.label).toBe("Snare");
    const drums = nodes.find((n) => n.id === "mod:drums");
    expect(drums?.outputs?.map((o) => o.name)).toEqual(["out", "Snare"]);
  });

  it("draws nothing for a feed whose node is not on the graph", () => {
    const { edges } = buildGraph(
      graph([{ node: "ghost", tap: "Snare", to: "snare-verb" }]),
    );
    expect(edges.some((e) => e.sourcePort === "Snare")).toBe(false);
  });
});
