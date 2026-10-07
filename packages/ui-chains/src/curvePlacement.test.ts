// A curve card beside the node it drives: on a fresh layout, and when it is new among cards that kept their place.

import { describe, expect, it } from "vitest";
import { withoutCurves } from "./curvePlacement";
import { layout, type RawEdge, type RawNode } from "./graph";

const card = (id: string, kind: RawNode["kind"], rank: number): RawNode =>
  ({ id, label: id, kind, w: 200, h: 120, rank }) as RawNode;

// Three modules in a row from one track, and a curve driving the LAST of them.
const nodes: RawNode[] = [
  card("t", "track", 1),
  card("a", "module", 2),
  card("b", "module", 2),
  card("c", "module", 2),
  card("crv", "curve", 2),
];
const edges: RawEdge[] = [
  { id: "e1", source: "t", target: "a" },
  { id: "e2", source: "t", target: "b" },
  { id: "e3", source: "t", target: "c" },
  {
    id: "e4",
    source: "crv",
    target: "c",
    automation: { param: "Gain" } as RawEdge["automation"],
  },
];
const at = (laid: ReturnType<typeof layout>, id: string) =>
  laid.nodes.find((n) => n.id === id) as { x: number; y: number; w: number };

describe("curve cards", () => {
  it("sit just left of their target on a fresh layout, under its top, nothing between them", () => {
    const laid = layout(nodes, edges);
    const crv = at(laid, "crv");
    const c = at(laid, "c");
    expect(crv.y).toBe(c.y + 24);
    const gap = c.x - (crv.x + crv.w);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(60);
  });

  it("stack down when several drive one node", () => {
    const two = [...nodes, card("crv2", "curve", 2)];
    const both = [
      ...edges,
      {
        id: "e5",
        source: "crv2",
        target: "c",
        automation: { param: "Res" } as RawEdge["automation"],
      },
    ];
    const laid = layout(two, both);
    const first = at(laid, "crv");
    const second = at(laid, "crv2");
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y + 120 + 24);
  });

  it("land at the left of where the target WAS drawn, under its top, wherever they were before", () => {
    const prev = new Map([
      ["t", { x: 0, y: 0 }],
      ["a", { x: 0, y: 300 }],
      ["b", { x: 1000, y: 300 }],
      ["c", { x: 2000, y: 900 }],
    ]);
    // Even a remembered spot of its own is overridden: a curve card follows its node.
    prev.set("crv", { x: 0, y: 0 });
    const crv = at(layout(nodes, edges, undefined, prev), "crv");
    expect(crv).toMatchObject({ x: 2000 - 200 - 24, y: 900 + 24 });
  });
});

describe("the zoomed-out graph", () => {
  it("drops every curve card and every cable touching one, and nothing else", () => {
    const g = withoutCurves({ nodes, edges });
    expect(g.nodes.map((n) => n.id)).toEqual(["t", "a", "b", "c"]);
    expect(g.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("hands back the same graph when it holds no curve", () => {
    const g = { nodes: nodes.slice(0, 2), edges: edges.slice(0, 1) };
    expect(withoutCurves(g)).toBe(g);
  });
});
