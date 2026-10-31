// The Graph panel frames one track's path: pins from the whole graph's canvas must not scatter it.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { layoutTrackPanel } from "./trackPanelLayout";

const GRAPH: WebGraph = {
  chains: {
    low: {
      from: "bass",
      use: [{ module: "amp" }, { module: "mix-bass" }],
      out: [{ to: "OUT", gain: 1 }],
    },
    lead: {
      from: "voice",
      use: [{ module: "verb" }],
      out: [{ to: "OUT", gain: 1 }],
    },
  },
  tracks: ["bass", "voice"],
  warnings: [],
  // Where the Chains tab put them: far down and right on a big project's canvas.
  positions: {
    amp: { x: 4200, y: 3100 },
    "mix-bass": { x: 4600, y: 3100 },
    OUT: { x: 9000, y: 200 },
  },
};

describe("layoutTrackPanel", () => {
  it("lays the track's path out compactly, whatever the whole graph pinned", () => {
    const laid = layoutTrackPanel(GRAPH, "bass", {});
    expect(laid).not.toBeNull();
    if (!laid) return;
    const labels = laid.nodes.map((n) => n.module ?? n.label);
    expect(labels).toEqual(expect.arrayContaining(["bass", "amp", "mix-bass"]));
    expect(labels).not.toContain("verb");
    // The box the camera fits: the cards, not the whole project's canvas.
    expect(laid.left).toBe(0);
    expect(laid.top).toBe(0);
    expect(laid.width).toBeLessThan(2000);
    expect(laid.height).toBeLessThan(2000);
  });

  it("keeps a card where the panel last drew it", () => {
    const first = layoutTrackPanel(GRAPH, "bass", {});
    const amp = first?.nodes.find((n) => n.module === "amp");
    expect(amp).toBeDefined();
    if (!amp) return;
    const held = new Map([[amp.id, { x: amp.x + 40, y: amp.y + 10 }]]);
    const again = layoutTrackPanel(GRAPH, "bass", {}, held);
    expect(again?.nodes.find((n) => n.id === amp.id)).toMatchObject({
      x: amp.x + 40,
      y: amp.y + 10,
    });
  });

  it("answers null for a track nothing routes", () => {
    expect(layoutTrackPanel(GRAPH, "drums", {})).toBeNull();
  });
});
