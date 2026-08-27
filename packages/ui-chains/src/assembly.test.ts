// A box closed and a box open, over the same graph. What is pinned here is the pair of rules the
// drawing turns on: a closed box hides its members and wears their boundary cables on its plugs,
// and a cable dropped on a plug is written against the MEMBER. See docs/graphBuild.md.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { foldAssemblies } from "./assembly";
import { jackRef } from "./cables";
import { assemblyId, buildGraph, type GraphNode, layout } from "./graph";

const BOX = {
  uses: "@st0/turntable",
  label: "Turntable",
  members: ["trimA", "fadeA"],
  inputs: [{ name: "in", type: "audio" as const, node: "trimA" }],
  outputs: [{ name: "mix", type: "audio" as const, node: "fadeA" }],
  params: { Trim: { node: "trimA", param: "Trim" } },
};

/** A lane through two modules into the sum, with the two modules declared one box. */
const GRAPH: WebGraph = {
  chains: {
    gtr: {
      from: "gtr",
      use: [{ module: "trimA" }, { module: "fadeA" }],
      // Straight to the device rather than to the sum: nothing is drawn INTO `MIX`, so a box
      // ending there would have no cable to put on its plug — see docs/graphBuild.md.
      out: [{ to: "OUT", gain: 1 }],
    },
  },
  tracks: ["gtr"],
  assemblies: { turntableA: BOX },
  warnings: [],
};

const fold = (open: string[] = []) =>
  foldAssemblies(GRAPH, buildGraph(GRAPH), new Set(open));

const byId = (nodes: GraphNode[] | { id: string }[]) =>
  new Map(nodes.map((n) => [n.id, n as GraphNode]));

describe("a CLOSED box", () => {
  it("draws instead of its members", () => {
    const { nodes } = fold();
    expect(nodes.some((n) => n.module === "trimA")).toBe(false);
    expect(nodes.some((n) => n.module === "fadeA")).toBe(false);
    const box = nodes.find((n) => n.kind === "assembly");
    expect(box?.id).toBe(assemblyId("turntableA"));
    expect(box?.label).toBe("Turntable");
    // The INSTANCE name, so a pin and `graph move` address the box rather than the template's label.
    expect(box?.module).toBe("turntableA");
  });

  it("wears the promoted params as knobs, bound by their promoted name", () => {
    const box = fold().nodes.find((n) => n.kind === "assembly");
    expect(Object.values(box?.ui?.widgets ?? {}).map((w) => w.bind)).toEqual([
      "Trim",
    ]);
    expect(box?.assemblyOf?.params?.Trim).toEqual({
      node: "trimA",
      param: "Trim",
    });
  });

  it("takes the boundary cables onto its plugs, and hides the one inside", () => {
    const { edges } = fold();
    const box = assemblyId("turntableA");
    // gtr -> trimA became gtr -> the box's `in`; fadeA -> OUT became the box's `mix` -> OUT.
    expect(
      edges.map((e) => [e.source, e.sourcePort, e.target, e.targetPort]),
    ).toEqual(
      expect.arrayContaining([
        ["trk:gtr", undefined, box, "in"],
        [box, "mix", "snk:OUT", undefined],
      ]),
    );
    // trimA -> fadeA is what the box is hiding.
    expect(edges.some((e) => e.source === e.target)).toBe(false);
    expect(edges.length).toBe(2);
  });

  it("shows a socket per plug, and NO socket where the template declares none", () => {
    const box = fold().nodes.find((n) => n.kind === "assembly");
    expect(box?.jacks?.in.map((j) => j.name)).toEqual(["in"]);
    expect(box?.jacks?.out.map((j) => j.name)).toEqual(["mix"]);
    // A source — a turntable — declares no input, and an input jack on one is a hole nothing fills.
    const source = foldAssemblies(
      { ...GRAPH, assemblies: { turntableA: { ...BOX, inputs: [] } } },
      buildGraph(GRAPH),
      new Set(),
    ).nodes.find((n) => n.kind === "assembly");
    expect(source?.jacks?.in).toEqual([]);
  });

  it("answers a plug with the MEMBER's address, and its bare name with its own", () => {
    const box = fold().nodes.find((n) => n.kind === "assembly") as GraphNode;
    expect(jackRef(box, "mix")).toBe("fadeA");
    expect(jackRef(box, "in")).toBe("trimA");
    // No port: this is the name a pin is written under, and it IS the box's.
    expect(jackRef(box)).toBe("turntableA");
  });
});

describe("an OPEN box", () => {
  it("keeps its members, tagged, and takes no plug of its own", () => {
    const { nodes, edges } = fold(["turntableA"]);
    const members = nodes.filter((n) => n.assembly === "turntableA");
    expect(members.map((n) => n.module).sort()).toEqual(["fadeA", "trimA"]);
    const box = nodes.find((n) => n.kind === "assembly");
    expect(box?.assemblyOf?.open).toBe(true);
    // A frame has no sockets: the members are showing the real ones and the cable lands on them.
    expect(box?.jacks).toEqual({ in: [], out: [] });
    // …so every cable is still the one buildGraph drew.
    expect(edges.length).toBe(3);
  });

  it("lays its members out INSIDE the frame", () => {
    const { nodes, edges } = fold(["turntableA"]);
    const laid = layout(nodes, edges);
    const box = laid.nodes.find((n) => n.kind === "assembly");
    expect(box).toBeDefined();
    if (!box) return;
    for (const m of laid.nodes.filter((n) => n.assembly === "turntableA")) {
      expect(m.x).toBeGreaterThanOrEqual(box.x);
      expect(m.y).toBeGreaterThanOrEqual(box.y);
      expect(m.x + m.w).toBeLessThanOrEqual(box.x + box.w);
      expect(m.y + m.h).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it("keeps every cable DRAWABLE — the members' own included", () => {
    const { nodes, edges } = fold(["turntableA"]);
    const laid = layout(nodes, edges);
    const at = byId(laid.nodes);
    const inside = new Set(
      laid.nodes.filter((n) => n.assembly === "turntableA").map((n) => n.id),
    );
    // The renderer skips an edge with fewer than two points — its test for "the layout could not
    // place this" — so a nested pass handing back none drew NO cable at all on such a graph.
    for (const e of laid.edges)
      expect(e.points.length).toBeGreaterThanOrEqual(2);
    // …and the internal one is there, with both its ends placed.
    const internal = laid.edges.filter(
      (e) => inside.has(e.source) && inside.has(e.target),
    );
    expect(internal.length).toBe(1);
    expect(at.get(internal[0].source)).toBeDefined();
    expect(at.get(internal[0].target)).toBeDefined();
  });

  it("frames every member and nothing else", () => {
    const { nodes, edges } = fold(["turntableA"]);
    const laid = layout(nodes, edges);
    expect(laid.nodes.length).toBe(nodes.length);
    expect(byId(laid.nodes).size).toBe(nodes.length);
  });
});

describe("which cables are the box's", () => {
  it("marks the ones inside it, and only those", () => {
    const { edges } = fold(["turntableA"]);
    const mine = edges.filter((e) => e.assembly === "turntableA");
    const crossing = edges.filter((e) => !e.assembly);
    // trimA -> fadeA is the box's; the lane's feed in and the fade's way out merely cross it.
    expect(mine.length).toBe(1);
    expect(crossing.length).toBe(2);
  });

  it("marks nothing while every box is closed", () => {
    expect(fold().edges.every((e) => !e.assembly)).toBe(true);
  });

  it("carries the mark through the layout, which is where the drawing reads it", () => {
    const f = fold(["turntableA"]);
    const laid = layout(f.nodes, f.edges);
    expect(laid.edges.filter((e) => e.assembly === "turntableA").length).toBe(
      1,
    );
  });
});

describe("making room for an open box", () => {
  /** Every card PINNED, which is the case that needs this: a pin outranks the layout, so opening a
   *  box grows one node and dagre is not allowed to move anything out of its way. */
  const pins = { gtr: { x: 0, y: 0 }, OUT: { x: 40, y: 900 } };
  const laidWith = (open: string[]) => {
    const f = fold(open);
    return layout(f.nodes, f.edges, pins);
  };
  const overlap = (a: GraphNode, b: GraphNode) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it("steps the cards in its way aside, and says where they belong", () => {
    const laid = laidWith(["turntableA"]);
    const frame = laid.nodes.find((n) => n.assemblyOf?.open) as GraphNode;
    const others = laid.nodes.filter(
      (n) => !n.assembly && n.kind !== "assembly",
    );
    expect(others.some((n) => overlap(n, frame))).toBe(false);
    for (const n of others.filter((x) => x.pushed))
      expect(n.pushed).not.toEqual({ x: n.x, y: n.y });
  });

  it("puts every one of them back when it closes — nothing was written down", () => {
    const open = laidWith(["turntableA"]);
    const shut = laidWith([]);
    const at = new Map(shut.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    for (const n of open.nodes) {
      if (n.assembly || n.kind === "assembly") continue;
      // Where a pushed card SAYS it belongs is where the closed graph actually draws it.
      expect(n.pushed ?? { x: n.x, y: n.y }).toEqual(at.get(n.id));
    }
  });

  it("leaves a graph with nothing in the way untouched", () => {
    const f = fold(["turntableA"]);
    const spread = layout(f.nodes, f.edges, {
      gtr: { x: 0, y: 0 },
      OUT: { x: 9000, y: 9000 },
    });
    expect(spread.nodes.filter((n) => n.pushed).length).toBe(0);
  });
});

describe("a graph declaring none", () => {
  it("is handed back untouched", () => {
    const bare = { ...GRAPH, assemblies: undefined };
    const built = buildGraph(bare);
    expect(foldAssemblies(bare, built)).toBe(built);
  });
});
