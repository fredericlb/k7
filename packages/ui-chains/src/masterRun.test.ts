// masterRun.test.ts — the master run set aside at the bottom right, and the inputs it is pushed below.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, layout, masterRunAside, pushBelowInputs } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

// The rule on its own, away from dagre: the cases a graph is hard to build for.
describe("pushBelowInputs", () => {
  const card = (id: string, y: number) => ({
    id,
    kind: "module" as const,
    label: id,
    x: 0,
    y,
    w: 100,
    h: 40,
  });
  const at = (nodes: ReturnType<typeof card>[], id: string) =>
    nodes.find((n) => n.id === id)?.y;

  it("carries a push all the way down a chain", () => {
    // Only `a` is out of place; `b` and `c` were fine until it moved, and must follow.
    const out = pushBelowInputs(
      [card("a", 500), card("b", 100), card("c", 200)],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    ) as ReturnType<typeof card>[];
    expect(at(out, "a")).toBe(500);
    expect(at(out, "b")).toBe(540);
    expect(at(out, "c")).toBe(580);
  });

  it("clears the LOWEST of several inputs, not the first one it meets", () => {
    const out = pushBelowInputs(
      [card("a", 10), card("b", 900), card("sum", 0)],
      [
        { source: "a", target: "sum" },
        { source: "b", target: "sum" },
      ],
    ) as ReturnType<typeof card>[];
    expect(at(out, "sum")).toBe(940);
  });

  it("returns the same array when nothing is out of place", () => {
    const nodes = [card("a", 0), card("b", 100)];
    expect(pushBelowInputs(nodes, [{ source: "a", target: "b" }])).toBe(nodes);
  });

  it("leaves a CYCLE alone rather than hanging on it", () => {
    // "Below its inputs" has no answer here, and a relaxation would run forever looking for one.
    const nodes = [card("a", 0), card("b", 0)];
    const out = pushBelowInputs(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]) as ReturnType<typeof card>[];
    expect([at(out, "a"), at(out, "b")]).toEqual([0, 0]);
  });

  it("ignores a node feeding itself, which constrains nothing", () => {
    const nodes = [card("a", 0)];
    expect(pushBelowInputs(nodes, [{ source: "a", target: "a" }])).toBe(nodes);
  });

  it("ignores an edge naming a node the graph does not draw", () => {
    const nodes = [card("a", 0)];
    expect(pushBelowInputs(nodes, [{ source: "ghost", target: "a" }])).toBe(
      nodes,
    );
  });
});

// The MASTER RUN stands fully right of the rest — a PREFERENCE, so unlike `pushBelowInputs` a pin outranks it.
describe("the master run goes to the bottom right", () => {
  // The two lanes meet at the SUM, and the master chain leaves it — `MIX -> OUT`, as a set is wired.
  const twoTracks = graph(
    {
      a: {
        from: "vox",
        use: [{ module: "comp" }],
        out: [{ to: "MIX", gain: 1 }],
      },
      b: {
        from: "gtr",
        use: [{ module: "eq" }],
        out: [{ to: "MIX", gain: 1 }],
      },
      MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
    },
    ["vox", "gtr"],
  );

  /** The rightmost edge of everything that is NOT on the master run. */
  const restRight = (laid: ReturnType<typeof layout>, run: Set<string>) =>
    Math.max(...laid.nodes.filter((n) => !run.has(n.id)).map((n) => n.x + n.w));

  /** The sum and what it feeds, by node id. */
  const runOf = (laid: ReturnType<typeof layout>) => {
    const sum = laid.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    const ids = new Set(sum ? [sum.id] : []);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of laid.edges)
        if (ids.has(e.source) && !ids.has(e.target)) {
          ids.add(e.target);
          grew = true;
        }
    }
    return ids;
  };

  it("puts the whole run past everything else", () => {
    const { nodes, edges } = buildGraph(twoTracks);
    const laid = layout(nodes, edges);
    const run = runOf(laid);
    expect(run.size).toBeGreaterThan(1); // the sum AND the output it feeds
    const edge = restRight(laid, run);
    for (const n of laid.nodes.filter((x) => run.has(x.id)))
      expect(n.x, n.label).toBeGreaterThanOrEqual(edge);
  });

  it("stands on the TRACK row, level with the lanes it sums, and right of every one of them", () => {
    const { nodes, edges } = buildGraph(twoTracks);
    const laid = layout(nodes, edges);
    const run = runOf(laid);
    const sum = laid.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    const lanes = laid.nodes.filter((n) => n.kind === "track");
    expect(sum?.y).toBe(Math.min(...lanes.map((n) => n.y)));
    // …and LAST on that row: right of everything that is not its own run.
    const right = Math.max(
      ...laid.nodes.filter((n) => !run.has(n.id)).map((n) => n.x + n.w),
    );
    expect(sum?.x).toBeGreaterThan(right);
  });

  it("makes the MIX -> OUT cable short instead of page-tall", () => {
    const { nodes, edges } = buildGraph(twoTracks);
    const laid = layout(nodes, edges);
    const sum = laid.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    const out = laid.nodes.find((n) => n.kind === "sink" && n.label === "OUT");
    const wire = (out?.y ?? 0) - ((sum?.y ?? 0) + (sum?.h ?? 0));
    // One rank apart, not the height of the graph — which is what this whole rule is for.
    expect(wire).toBeLessThanOrEqual(120);
    expect(wire).toBeGreaterThanOrEqual(0);
  });

  it("a PIN still wins: where the column sits is a preference, not a correctness rule", () => {
    const { nodes, edges } = buildGraph(twoTracks);
    const laid = layout(nodes, edges, { MIX: { x: 0, y: 0 } });
    const sum = laid.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    expect(sum?.x).toBe(0);
  });
});

// The rule on its own, where the shift can be checked against numbers rather than against dagre.
describe("masterRunAside", () => {
  const card = (id: string, kind: "sink" | "module", x: number, y = 0) => ({
    id,
    kind,
    label: id,
    x,
    y,
    w: 100,
    h: 40,
  });

  it("shifts the run as a BLOCK on both axes, keeping the gaps inside it", () => {
    // Laid out badly on purpose: the run at the origin, up and to the LEFT of the two lanes.
    const out = masterRunAside(
      [
        card("MIX", "sink", 0, 0),
        card("OUT", "sink", 40, 90),
        card("a", "module", 500, 300),
        card("b", "module", 900, 700),
      ],
      [
        { source: "MIX", target: "OUT" },
        { source: "a", target: "MIX" },
        { source: "b", target: "MIX" },
      ],
    );
    const at = (id: string) => out.find((n) => n.id === id);
    // `b` ends at x=1000 and y=740, so the run starts one separation past each.
    expect(at("MIX")).toMatchObject({ x: 1060, y: 810 });
    // …and keeps its OWN 40px and 90px offsets: shifted, never re-laid-out.
    expect(at("OUT")).toMatchObject({ x: 1100, y: 900 });
    expect(at("a")).toMatchObject({ x: 500, y: 300 });
  });

  it("pulls it back IN when it was left too far out", () => {
    const out = masterRunAside(
      [card("MIX", "sink", 5000, 5000), card("a", "module", 0, 0)],
      [{ source: "a", target: "MIX" }],
    );
    // A POSITION, not a minimum: a column miles out is not organised either.
    expect(out.find((n) => n.id === "MIX")).toMatchObject({ x: 160, y: 110 });
  });

  it("takes the whole run, however deep — a master chain may carry modules", () => {
    const out = masterRunAside(
      [
        card("MIX", "sink", 0, 0),
        card("limiter", "module", 10, 50),
        card("OUT", "sink", 20, 100),
        card("a", "module", 400, 400),
      ],
      [
        { source: "MIX", target: "limiter" },
        { source: "limiter", target: "OUT" },
        { source: "a", target: "MIX" },
      ],
    );
    // The limiter travels with the sum it processes, on both axes: the RUN moves, not two cards.
    for (const id of ["MIX", "limiter", "OUT"]) {
      expect(out.find((n) => n.id === id)?.x, id).toBeGreaterThanOrEqual(500);
      expect(out.find((n) => n.id === id)?.y, id).toBeGreaterThanOrEqual(440);
    }
  });

  it("does nothing to a graph with no sum drawn", () => {
    const nodes = [card("a", "module", 0), card("OUT", "sink", 100, 100)];
    expect(masterRunAside(nodes, [{ source: "a", target: "OUT" }])).toBe(nodes);
  });

  it("does nothing when the run is the WHOLE graph", () => {
    // No rest for it to stand to the right of, and `Math.max` of nothing is -Infinity.
    const nodes = [card("MIX", "sink", 0), card("OUT", "sink", 40, 90)];
    expect(masterRunAside(nodes, [{ source: "MIX", target: "OUT" }])).toBe(
      nodes,
    );
  });
});
