// A lane's FADER wears that lane's face. The graph document says which node that is (`trackMixers`),
// keyed by TRACK like every other per-lane map; the node needs the other direction, so what is
// pinned here is that the inversion happens and that it touches nothing else.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const CHAINS: WebGraph["chains"] = {
  lead: {
    from: "gt_lead",
    use: [{ module: "amp" }, { module: "strip" }],
    out: [{ to: "MIX", gain: 1 }],
  },
};

const graph = (trackMixers?: WebGraph["trackMixers"]): WebGraph => ({
  chains: CHAINS,
  tracks: ["gt_lead"],
  ...(trackMixers ? { trackMixers } : {}),
  warnings: [],
});

const byModule = (g: WebGraph, module: string) =>
  buildGraph(g).nodes.find((n) => n.module === module);

describe("trackFace", () => {
  it("is unset when the document names no mixer — nothing invents one", () => {
    expect(byModule(graph(), "strip")?.trackFace).toBeUndefined();
  });

  it("names the LANE on the node the document points at", () => {
    expect(byModule(graph({ gt_lead: "strip" }), "strip")?.trackFace).toBe(
      "gt_lead",
    );
  });

  it("leaves every other module in the chain alone", () => {
    expect(
      byModule(graph({ gt_lead: "strip" }), "amp")?.trackFace,
    ).toBeUndefined();
  });

  it("changes neither the node's own name nor how a command addresses it", () => {
    const n = byModule(graph({ gt_lead: "strip" }), "strip");
    // The card READS as the lane; the node is still `strip`, or every verb aimed at it would miss.
    expect(n?.label).toBe("strip");
    expect(n?.module).toBe("strip");
  });

  it("says nothing about a mixer this graph does not draw", () => {
    const g = graph({ gt_lead: "strip", drums: "nowhere" });
    expect(buildGraph(g).nodes.some((n) => n.trackFace === "drums")).toBe(
      false,
    );
  });

  it("leaves the TRACK node's own face untouched — it already had one", () => {
    const t = buildGraph(graph({ gt_lead: "strip" })).nodes.find(
      (n) => n.kind === "track",
    );
    expect(t?.label).toBe("gt_lead");
    expect(t?.trackFace).toBeUndefined();
  });
});
