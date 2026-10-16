// The placeholder a `+` pick draws: sized like the node, standing where the verb pins it, wired in.

import type {
  GraphEdge,
  GraphNode,
  LaidOutGraph,
} from "@studio/ui-chains/graph";
import { nodeSize } from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import { pendingNodeId, spawnBox, withPendingNode } from "./pendingNode";

const card = (id: string, label: string, x: number, y: number): GraphNode => ({
  id,
  label,
  module: label,
  kind: "module",
  dim: false,
  missing: false,
  stub: false,
  notSupported: false,
  unknownPlugin: false,
  hasNativePluginUI: false,
  x,
  y,
  w: 160,
  h: 70,
});

const arrow: GraphEdge = {
  id: "e1",
  source: "mod:comp",
  target: "mod:eq",
  signal: "audio",
  targetSlot: 0,
  points: [
    { x: 80, y: 70 },
    { x: 80, y: 300 },
  ],
};

const laid: LaidOutGraph = {
  nodes: [card("mod:comp", "comp", 0, 0), card("mod:eq", "eq", 0, 300)],
  edges: [arrow],
  width: 400,
  height: 400,
  left: 0,
  top: 0,
};

describe("spawnBox", () => {
  it("is the size the panel gives the card, centred on the click", () => {
    const panel = { cols: 3, rows: 2 };
    const { w, h } = nodeSize({ ...panel, widgets: {} });
    expect(spawnBox({ x: 500, y: 200 }, panel)).toEqual({
      x: Math.round(500 - w / 2),
      y: Math.round(200 - h / 2),
      w,
      h,
    });
  });

  it("falls back to the plain card for a module with no panel", () => {
    const { w, h } = nodeSize(undefined);
    expect(spawnBox({ x: 0, y: 0 })).toMatchObject({ w, h });
  });
});

describe("withPendingNode", () => {
  const pending = {
    before: "comp",
    after: "eq",
    node: "lead_adt_1",
    x: 10,
    y: 150,
    w: 88,
    h: 110,
  };

  it("stands in the arrow under the real node's id, at the pinned box, wired both ways", () => {
    const out = withPendingNode(laid, pending);
    const node = out.nodes.find((n) => n.id === pendingNodeId("lead_adt_1"));
    expect(node).toMatchObject({ pending: true, x: 10, y: 150, w: 88, h: 110 });
    expect(out.edges.map((e) => [e.source, e.target])).toEqual([
      ["mod:comp", "mod:lead_adt_1"],
      ["mod:lead_adt_1", "mod:eq"],
    ]);
    // The arrow's socket on the far end is kept, or the new cable lands on a different jack.
    expect(out.edges[1].targetSlot).toBe(0);
  });

  it("reads an arrow end that names a port", () => {
    const out = withPendingNode(laid, { ...pending, after: "eq#b" });
    expect(out.edges).toHaveLength(2);
  });

  it("keeps the real card once the node exists, and draws only the splice", () => {
    const landed = {
      ...laid,
      nodes: [...laid.nodes, card("mod:lead_adt_1", "lead_adt_1", 10, 150)],
    };
    const out = withPendingNode(landed, pending);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes.some((n) => n.pending)).toBe(false);
    expect(out.edges).toHaveLength(2);
  });

  it("steps aside once the real graph has spliced it", () => {
    const spliced = {
      ...laid,
      nodes: [...laid.nodes, card("mod:lead_adt_1", "lead_adt_1", 10, 150)],
      edges: [{ ...arrow, id: "e2", target: "mod:lead_adt_1" }],
    };
    expect(withPendingNode(spliced, pending)).toBe(spliced);
  });

  it("draws nothing on an arrow it cannot find", () => {
    expect(withPendingNode(laid, { ...pending, before: "gone" })).toBe(laid);
  });
});
