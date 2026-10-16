// moduleRow.test.ts — named modules laid out side by side: plain, with their cables, scaled, and
// with their curves.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, jackPoint, layout, moduleRow } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("moduleRow", () => {
  // The Mixer panel: named modules side by side in the caller's order. See docs/graphBuild.md.
  const three = graph(
    {
      a: {
        from: "vox",
        use: [{ module: "mx-vox" }],
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

  it("places them left to right in the order asked for, not the graph's", () => {
    const row = moduleRow(three, ["mx-gtr", "mx-vox", "mx-bass"]);
    expect(row.nodes.map((n) => n.module)).toEqual([
      "mx-gtr",
      "mx-vox",
      "mx-bass",
    ]);
    // Strictly increasing x, all on one line.
    const xs = row.nodes.map((n) => n.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(row.nodes.map((n) => n.y)).size).toBe(1);
  });

  it("leaves a gap between cards rather than butting them together", () => {
    const row = moduleRow(three, ["mx-vox", "mx-bass"]);
    const [first, second] = row.nodes;
    expect(second.x).toBeGreaterThan(first.x + first.w);
  });

  it("keeps the node the full graph would draw — the card, not a copy of it", () => {
    // Same id, same size, same chain: only the position is the row's, so nothing is re-implemented.
    const built = buildGraph(three);
    const full = layout(built.nodes, built.edges);
    const fromFull = full.nodes.find((n) => n.module === "mx-vox");
    const fromRow = moduleRow(three, ["mx-vox"]).nodes[0];
    expect(fromRow.id).toBe(fromFull?.id);
    expect(fromRow.w).toBe(fromFull?.w);
    expect(fromRow.h).toBe(fromFull?.h);
    expect(fromRow.chain).toBe(fromFull?.chain);
  });

  it("strips the sockets, which on an edgeless row would plug into nothing", () => {
    // The full graph gives this card jacks; here there are no cables, so plates would be furniture.
    const built = buildGraph(three);
    const fromFull = layout(built.nodes, built.edges).nodes.find(
      (n) => n.module === "mx-vox",
    );
    expect(
      (fromFull?.jacks?.in.length ?? 0) + (fromFull?.jacks?.out.length ?? 0),
    ).toBeGreaterThan(0);
    for (const n of moduleRow(three, ["mx-vox", "mx-bass"]).nodes)
      expect(n.jacks).toBeUndefined();
  });

  it("skips a name the graph does not have, rather than leaving a hole", () => {
    // The list and the graph are fetched separately, so the two can be one reload apart.
    const row = moduleRow(three, ["mx-vox", "gone", "mx-bass"]);
    expect(row.nodes.map((n) => n.module)).toEqual(["mx-vox", "mx-bass"]);
  });

  it("has no extent when nothing is named", () => {
    const row = moduleRow(three, []);
    expect(row.nodes).toHaveLength(0);
    expect(row.width).toBe(0);
    expect(row.height).toBe(0);
    expect(row.edges).toEqual([]);
  });
});

describe("moduleRow with links", () => {
  // One lane's signal path: the cables are carried, and a row read ACROSS meets them on the sides.
  const lane = graph(
    {
      vox: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox"],
  );

  it("carries the graph's own cables between the cards it kept", () => {
    const row = moduleRow(lane, ["comp", "eq"], { links: true });
    expect(row.edges).toHaveLength(1);
    expect(row.edges[0]).toMatchObject({
      source: "mod:comp",
      target: "mod:eq",
    });
  });

  it("keeps none of them when links are off — the strips rank asks for that", () => {
    expect(moduleRow(lane, ["comp", "eq"]).edges).toEqual([]);
  });

  it("invents nothing between neighbours the graph does not join", () => {
    // Two cards with no cable between them is the truth about a lane whose chains do not touch.
    const apart = graph(
      {
        a: {
          from: "vox",
          use: [{ module: "one" }],
          out: [{ to: "OUT", gain: 1 }],
        },
        b: {
          from: "vox",
          use: [{ module: "two" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["vox"],
    );
    expect(moduleRow(apart, ["one", "two"], { links: true }).edges).toEqual([]);
  });

  it("meets its cables on the SIDES, not the top and bottom", () => {
    const row = moduleRow(lane, ["comp", "eq"], { links: true });
    const [a, b] = row.nodes;
    const out = jackPoint(a, "out", 0);
    const into = jackPoint(b, "in", 0);
    // Out of the right edge, into the left, both at mid-height — a cable travelling sideways.
    expect(out.x).toBeGreaterThan(a.x + a.w);
    expect(into.x).toBeLessThan(b.x);
    expect(out.y).toBeCloseTo(a.y + a.h / 2);
    expect(into.y).toBeCloseTo(b.y + b.h / 2);
  });

  it("gives every card the SAME height, so none of them is short", () => {
    // The camera fits the row's height, so one height makes every card the height of the view.
    const tall = graph(
      {
        vox: {
          from: "vox",
          use: [
            { module: "comp", ui: { cols: 2, rows: 4, widgets: {} } },
            { module: "eq" },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["vox"],
    );
    const hs = moduleRow(tall, ["comp", "eq"], { links: true }).nodes.map(
      (n) => n.h,
    );
    expect(new Set(hs).size).toBe(1);
    expect(hs[0]).toBe(Math.max(...hs));
  });
});

describe("moduleRow width scale", () => {
  const one = graph(
    {
      a: {
        from: "vox",
        use: [{ module: "mx-vox" }],
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

  it("widens each card without touching its height", () => {
    // Elbow room, not bigger controls: the grid is a fixed cell size, so the height must not move.
    const plain = moduleRow(one, ["mx-vox"]).nodes[0];
    const wide = moduleRow(one, ["mx-vox"], { widthScale: 1.5 }).nodes[0];
    expect(wide.w).toBe(Math.round(plain.w * 1.5));
    expect(wide.h).toBe(plain.h);
  });

  it("spaces the row by the WIDENED width, so cards still cannot overlap", () => {
    const row = moduleRow(one, ["mx-vox", "mx-bass"], { widthScale: 1.5 });
    const [first, second] = row.nodes;
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w);
    expect(row.width).toBeGreaterThan(second.x + second.w - 1);
  });

  it("defaults to the card's own width", () => {
    expect(moduleRow(one, ["mx-vox"]).nodes[0].w).toBe(
      moduleRow(one, ["mx-vox"], { widthScale: 1 }).nodes[0].w,
    );
  });
});

describe("moduleRow with curves", () => {
  // One lane, its eq driven by a curve.
  const lane = {
    ...graph(
      {
        vox: {
          from: "vox",
          use: [
            { module: "comp" },
            { module: "eq", automations: [{ param: "Gain", curve: "wob" }] },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["vox"],
    ),
    curves: { wob: { type: "lfo" as const, shape: "sine" as const } },
  };
  const opts = { links: true, gap: -1 } as const;

  it("keeps the automation landing on a card with no curve card drawn, so its knob glows", () => {
    const row = moduleRow(lane, ["comp", "eq"], opts);
    expect(row.nodes.some((n) => n.kind === "curve")).toBe(false);
    const auto = row.edges.filter((e) => e.automation);
    expect(auto).toHaveLength(1);
    expect(auto[0].target).toBe("mod:eq");
  });

  it("draws no event plug while its curves are hidden, and the node's own when they are shown", () => {
    const withNotes = {
      ...lane,
      chains: {
        vox: {
          ...lane.chains.vox,
          use: lane.chains.vox.use.map((u) => ({ ...u, events: ["note-on"] })),
        },
      },
    };
    const card = (curves: boolean) =>
      moduleRow(withNotes, ["comp", "eq"], { ...opts, curves }).nodes.find(
        (n) => n.module === "eq",
      );
    expect(card(false)?.events).toBeUndefined();
    expect(card(true)?.events).toEqual(["note-on"]);
  });

  it("draws the curve in a column just before the card it drives, under its top, the neighbours spaced", () => {
    const row = moduleRow(lane, ["comp", "eq"], { ...opts, curves: true });
    const at = (kind: string, module?: string) =>
      row.nodes.find(
        (n) => n.kind === kind && (!module || n.module === module),
      );
    const comp = at("module", "comp");
    const eq = at("module", "eq");
    const crv = at("curve");
    if (!comp || !eq || !crv) throw new Error("three cards");
    expect(crv.x).toBeGreaterThan(comp.x + comp.w);
    expect(eq.x).toBeGreaterThan(crv.x + crv.w);
    expect(crv.y).toBe(eq.y + 24);
    // …and its cable is a whole one now, both ends in the row.
    expect(row.edges.find((e) => e.automation)?.source).toBe(crv.id);
  });
});
