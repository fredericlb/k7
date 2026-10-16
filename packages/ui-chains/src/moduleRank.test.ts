// moduleRank.test.ts — the passes that line modules up on one rank and space them evenly.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  alignModuleRank,
  buildGraph,
  layout,
  spaceModulesEvenly,
} from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("alignModuleRank", () => {
  // The Mixer VIEW: the same graph with the strips pulled onto one rank. See docs/graphBuild.md.
  const uneven = graph(
    {
      a: {
        from: "vox",
        use: [{ module: "comp" }, { module: "mx-vox" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      b: {
        from: "bass",
        use: [{ module: "mx-bass" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox", "bass"],
  );

  const rankOf = (nodes: ReturnType<typeof buildGraph>["nodes"], mod: string) =>
    nodes.find((n) => n.module === mod)?.rank;

  it("leaves the graph alone when fewer than two of the names are in it", () => {
    const { nodes } = buildGraph(uneven);
    expect(alignModuleRank(nodes, ["mx-vox"])).toBe(nodes);
    expect(alignModuleRank(nodes, [])).toBe(nodes);
    expect(alignModuleRank(nodes, ["nope", "gone"])).toBe(nodes);
  });

  it("puts them on ONE rank — the deepest, never a shallower one", () => {
    const { nodes } = buildGraph(uneven);
    const before = rankOf(nodes, "mx-vox");
    expect(before).toBeGreaterThan(rankOf(nodes, "mx-bass") ?? 0); // the staircase
    const out = alignModuleRank(nodes, ["mx-vox", "mx-bass"]);
    expect(rankOf(out, "mx-bass")).toBe(before);
    expect(rankOf(out, "mx-vox")).toBe(before);
  });

  it("pushes the sink past the row, so no cable has to climb", () => {
    const { nodes } = buildGraph(uneven);
    const out = alignModuleRank(nodes, ["mx-vox", "mx-bass"]);
    const shared = rankOf(out, "mx-vox") ?? 0;
    for (const n of out.filter((x) => x.kind === "sink"))
      expect(n.rank ?? 0).toBeGreaterThan(shared);
  });

  it("does not touch the nodes it was given", () => {
    const { nodes } = buildGraph(uneven);
    const was = rankOf(nodes, "mx-bass");
    alignModuleRank(nodes, ["mx-vox", "mx-bass"]);
    expect(rankOf(nodes, "mx-bass")).toBe(was);
  });
});

describe("spaceModulesEvenly", () => {
  // A shared rank is one LINE; this gives it one RHYTHM, against gaps measured at 152/136/356/116.
  const uneven = graph(
    {
      a: {
        from: "vox",
        use: [
          { module: "comp", ui: { cols: 8, rows: 2, widgets: {} } },
          { module: "mx-vox" },
        ],
        out: [
          { to: "OUT", gain: 1 },
          { to: "reverb", gain: 0.3 },
        ],
      },
      reverb: {
        use: [{ module: "conv" }, { module: "mx-verb" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      b: {
        from: "bass",
        use: [{ module: "mx-bass" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      c: {
        from: "gtr",
        use: [{ module: "mx-gtr" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox", "bass", "gtr"],
  );

  const row = ["mx-vox", "mx-verb", "mx-bass", "mx-gtr"];
  const laidRow = () => {
    const { nodes, edges } = buildGraph(uneven);
    return spaceModulesEvenly(layout(alignModuleRank(nodes, row), edges), row);
  };
  const pick = (l: ReturnType<typeof laidRow>, mod: string) =>
    l.nodes.find((n) => n.module === mod);

  it("leaves the graph alone when fewer than two of the names are in it", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges);
    expect(spaceModulesEvenly(laid, ["mx-vox"])).toBe(laid);
    expect(spaceModulesEvenly(laid, [])).toBe(laid);
  });

  const gapsOf = (l: ReturnType<typeof laidRow>) => {
    const out: number[] = [];
    const sorted = row
      .map((m) => pick(l, m))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++)
      out.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w));
    return out;
  };

  it("leaves the SAME gap between every pair, and it is the STRIP's", () => {
    // One gap, and 24 is the assertion: "all gaps equal" would pass with this function removed.
    expect(gapsOf(laidRow())).toEqual([24, 24, 24]);
  });

  it("orders them as ASKED, not as the graph laid them out", () => {
    const l = laidRow();
    const xs = row.map((m) => pick(l, m)?.x ?? 0);
    expect([...xs]).toEqual([...xs].sort((a, b) => a - b));
  });

  it("starts where the row already began, rather than at the origin", () => {
    const { nodes, edges } = buildGraph(uneven);
    const before = layout(alignModuleRank(nodes, row), edges);
    const was = Math.min(
      ...before.nodes
        .filter((n) => n.module?.startsWith("mx-"))
        .map((n) => n.x),
    );
    const after = spaceModulesEvenly(before, row);
    expect(Math.min(...row.map((m) => pick(after, m)?.x ?? 0))).toBe(was);
  });

  it("leaves the cables alone — a moved card takes its own with it", () => {
    const { nodes, edges } = buildGraph(uneven);
    const before = layout(alignModuleRank(nodes, row), edges);
    const after = spaceModulesEvenly(before, row);
    // `cablePath` reads both ends off the nodes, so re-spacing a card re-routes its cable for free.
    expect(after.edges).toBe(before.edges);
  });

  it("widens the graph when the row runs past what dagre measured", () => {
    const { nodes, edges } = buildGraph(uneven);
    const before = layout(alignModuleRank(nodes, row), edges);
    const after = spaceModulesEvenly(before, row);
    const right = Math.max(
      ...row.map((m) => (pick(after, m)?.x ?? 0) + (pick(after, m)?.w ?? 0)),
    );
    expect(after.width).toBeGreaterThanOrEqual(right);
  });
});
