// A module that has been PLACED but not wired.
//
// chains.yaml can hold one now (`modules: { x: [] }`), which is what a right-click on empty canvas creates: drop
// it in, connect it after. The graph is the only place it can be connected FROM, so if it doesn't draw, it is a
// node the file says exists and the user can neither see nor reach — worse than not creating it at all.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const graph = (chains: WebGraph["chains"], tracks: string[]): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("a parked module", () => {
  const g = graph(
    {
      melody: {
        from: "melody",
        use: [{ module: "synth" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      // What deriveChains makes of `modules: { wah: [] }` — a run of one, going nowhere.
      wah: { use: [{ module: "wah" }], out: [] },
    },
    ["melody"],
  );
  const built = buildGraph(g);
  const byId = Object.fromEntries(built.nodes.map((n) => [n.id, n]));

  it("draws, like any other module", () => {
    expect(byId["mod:wah"]).toBeTruthy();
    expect(byId["mod:wah"].label).toBe("wah");
    expect(byId["mod:wah"].module).toBe("wah");
  });

  it("draws no cable, because it has none", () => {
    // Not the same as "is hidden": the node is there to be dragged a cable onto. An edge
    // invented here would be a connection the file does not have.
    expect(
      built.edges.filter(
        (e) => e.source === "mod:wah" || e.target === "mod:wah",
      ),
    ).toEqual([]);
  });

  it("leaves the wired half of the graph alone", () => {
    expect(byId["trk:melody"]).toBeTruthy();
    expect(byId["mod:synth"]).toBeTruthy();
    expect(byId["snk:OUT"]).toBeTruthy();
    expect(
      built.edges.some(
        (e) => e.source === "mod:synth" && e.target === "snk:OUT",
      ),
    ).toBe(true);
  });

  it("is not dimmed or marked missing — it exists, it just goes nowhere", () => {
    expect(byId["mod:wah"].dim).toBe(false);
    expect(byId["mod:wah"].missing).toBe(false);
  });
});
