// What the auto-organized graph reads as, top to bottom: the INPUTS, then the TRACKS on one row, then
// their modules, then every lane's FADER on one row — the deepest lane's. Pinned on the laid-out
// drawing rather than on ranks, since the drawing is what somebody reads (docs/graphBuild.md).

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, layout } from "./graph";

const AUDIO = "audio" as const;

// A long lane and a short one, each ending on its fader, and a live input playing into the long one.
const G: WebGraph = {
  chains: {
    lead: {
      from: "gt_lead",
      use: [
        { module: "amp", emits: AUDIO },
        { module: "cab", emits: AUDIO },
        { module: "lead_strip", emits: AUDIO },
        { module: "lead_after", emits: AUDIO },
      ],
      out: [{ to: "MIX", gain: 1 }],
    },
    bass: {
      from: "bs_bass",
      use: [{ module: "bass_strip", emits: AUDIO }],
      out: [{ to: "MIX", gain: 1 }],
    },
    // As the file service spells one: a chain with NO source, its one step the input, sent to the lane.
    guitar_in: {
      use: [{ module: "guitar_in", emits: AUDIO, monitor: "auto" as const }],
      out: [{ to: "gt_lead", gain: 1 }],
    },
  },
  tracks: ["gt_lead", "bs_bass"],
  trackMixers: { gt_lead: "lead_strip", bs_bass: "bass_strip" },
  warnings: [],
};

const drawn = () => {
  const { nodes, edges } = buildGraph(G);
  const laid = layout(nodes, edges);
  const y = (pred: (n: (typeof laid.nodes)[number]) => boolean) => {
    const n = laid.nodes.find(pred);
    if (!n) throw new Error("node not drawn");
    return n.y;
  };
  return {
    track: (id: string) => y((n) => n.kind === "track" && n.label === id),
    module: (m: string) => y((n) => n.kind === "module" && n.module === m),
  };
};

describe("the auto-organized vertical order", () => {
  it("puts a live input ABOVE the tracks, which it feeds", () => {
    const d = drawn();
    expect(d.module("guitar_in")).toBeLessThan(d.track("gt_lead"));
    expect(d.module("guitar_in")).toBeLessThan(d.track("bs_bass"));
  });

  it("starts every track on the same row, the one an input feeds included", () => {
    const d = drawn();
    expect(d.track("gt_lead")).toBe(d.track("bs_bass"));
  });

  it("puts every lane's modules below the tracks", () => {
    const d = drawn();
    expect(d.module("amp")).toBeGreaterThan(d.track("gt_lead"));
    expect(d.module("cab")).toBeGreaterThan(d.module("amp"));
  });

  it("starts every fader on one row — the deepest lane's", () => {
    const d = drawn();
    expect(d.module("bass_strip")).toBe(d.module("lead_strip"));
    // The long lane decides the row: its fader sits below the modules before it.
    expect(d.module("lead_strip")).toBeGreaterThan(d.module("cab"));
  });

  it("keeps what follows a fader BELOW it", () => {
    const d = drawn();
    expect(d.module("lead_after")).toBeGreaterThan(d.module("lead_strip"));
  });
});
