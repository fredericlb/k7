// graphLayout.test.ts — the dagre layout: one row per rank, one line of tracks, the pins, and a
// receiver kept below what feeds it.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, layout } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("layout puts every rank on its own row", () => {
  // dagre treats a rank as a hint and pushes a node as LATE as it can. See docs/graphBuild.md.
  const deepAndShallow = graph(
    {
      long: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }, { module: "verb" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      short: {
        from: "bass",
        use: [{ module: "drive" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox", "bass"],
  );

  const laid = () => {
    const { nodes, edges } = buildGraph(deepAndShallow);
    const rank = new Map(nodes.map((n) => [n.id, n.rank]));
    return { l: layout(nodes, edges), rank };
  };

  it("gives each rank ONE y", () => {
    const { l, rank } = laid();
    const rows = new Map<number, Set<number>>();
    for (const n of l.nodes) {
      const r = rank.get(n.id);
      if (r == null) continue;
      if (!rows.has(r)) rows.set(r, new Set());
      (rows.get(r) as Set<number>).add(n.y);
    }
    for (const [, ys] of rows) expect(ys.size).toBe(1);
  });

  it("puts the short chain's module at the TOP, beside the deep one's first", () => {
    const { l } = laid();
    const y = (mod: string) => l.nodes.find((n) => n.module === mod)?.y ?? 0;
    // `drive` and `comp` are each first in their chain: same rank, so same row.
    expect(y("drive")).toBe(y("comp"));
    expect(y("drive")).toBeLessThan(y("verb"));
  });

  it("keeps the rows in order and never lets one sit on the one above", () => {
    const { l, rank } = laid();
    const rows = [...new Set(l.nodes.map((n) => rank.get(n.id)))]
      .filter((r): r is number => r != null)
      .sort((a, b) => a - b);
    let prevBottom = Number.NEGATIVE_INFINITY;
    for (const r of rows) {
      const of = l.nodes.filter((n) => rank.get(n.id) === r);
      expect(Math.min(...of.map((n) => n.y))).toBeGreaterThanOrEqual(
        prevBottom,
      );
      prevBottom = Math.max(...of.map((n) => n.y + n.h));
    }
  });

  it("parts two nodes the collapse would have stacked", () => {
    // dagre places x assuming its own y, so collapsing two lines onto one row can overlap them.
    const { l } = laid();
    const a = l.nodes;
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++)
        expect(
          a[i].x < a[j].x + a[j].w &&
            a[j].x < a[i].x + a[i].w &&
            a[i].y < a[j].y + a[j].h &&
            a[j].y < a[i].y + a[i].h,
        ).toBe(false);
  });

  it("reports an extent that covers where the nodes ACTUALLY are", () => {
    // dagre's own figure describes the picture before the rows moved — 488px short, measured.
    const { l } = laid();
    expect(l.width).toBeGreaterThanOrEqual(
      Math.max(...l.nodes.map((n) => n.x + n.w)),
    );
    expect(l.height).toBeGreaterThanOrEqual(
      Math.max(...l.nodes.map((n) => n.y + n.h)),
    );
  });
});

describe("layout puts every track on one line", () => {
  // Tracks carry `rank: 0` and dagre overrides it, scattering the source line. docs/graphBuild.md.
  const uneven = graph(
    {
      long: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }, { module: "mx-vox" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      short: {
        from: "bass",
        use: [{ module: "mx-bass" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox", "bass"],
  );

  it("gives them ONE y, whatever hangs under each", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges);
    const tracks = laid.nodes.filter((n) => n.kind === "track");
    expect(tracks.length).toBe(2);
    expect(new Set(tracks.map((n) => n.y)).size).toBe(1);
  });

  it("puts that line at the TOP — a source is not below what it feeds", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges);
    const trackY = laid.nodes.find((n) => n.kind === "track")?.y ?? 0;
    for (const n of laid.nodes.filter((x) => x.kind === "module"))
      expect(n.y).toBeGreaterThanOrEqual(trackY);
  });

  it("leaves the x alone — their spacing follows what hangs under them", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges);
    const xs = laid.nodes.filter((n) => n.kind === "track").map((n) => n.x);
    // Two tracks, two different columns: this aligns a line, it does not build a rank.
    expect(new Set(xs).size).toBe(2);
  });
});

describe("layout honours the pins", () => {
  const uneven = graph(
    {
      long: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox"],
  );

  it("a pinned module sits exactly where its pin says; everything ABOVE it keeps dagre's answer", () => {
    const { nodes, edges } = buildGraph(uneven);
    const free = layout(nodes, edges);
    const laid = layout(nodes, edges, { comp: { x: 640, y: 480 } });
    const comp = laid.nodes.find((n) => n.module === "comp");
    expect(comp).toMatchObject({ x: 640, y: 480 });
    // Its own INPUTS are untouched — dagre still owns everything the pin does not stand under.
    const vox = laid.nodes.find((x) => x.label === "vox");
    const wasVox = free.nodes.find((f) => f.id === vox?.id);
    expect({ x: vox?.x, y: vox?.y }).toEqual({ x: wasVox?.x, y: wasVox?.y });
    // What it FEEDS follows it down: a cable may not climb, so dragging a card drags its consumers.
    const eq = laid.nodes.find((x) => x.module === "eq");
    expect(eq?.y).toBeGreaterThanOrEqual(480 + (comp?.h ?? 0));
  });

  it("a pinned node still counts toward the graph's measured size", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges, { comp: { x: 2000, y: 1500 } });
    expect(laid.width).toBeGreaterThan(2000);
    expect(laid.height).toBeGreaterThan(1500);
  });

  it("a graph nobody dragged begins at the origin", () => {
    const { nodes, edges } = buildGraph(uneven);
    const laid = layout(nodes, edges);
    expect({ left: laid.left, top: laid.top }).toEqual({ left: 0, top: 0 });
  });

  it("a pin ABOVE the first track is reported, so the camera can still frame it", () => {
    const { nodes, edges } = buildGraph(uneven);
    // The TRACK, being a source, is free to go up there; a pinned module would be pushed back down.
    const laid = layout(nodes, edges, { vox: { x: -200, y: -300 } });
    // Both past the pin by the margin every extent carries, and never positive.
    expect(laid.top).toBeLessThanOrEqual(-300);
    expect(laid.left).toBeLessThanOrEqual(-200);
    expect(laid.height - laid.top).toBeGreaterThan(300);
  });

  it("a pin for a name the graph does not draw changes nothing", () => {
    const { nodes, edges } = buildGraph(uneven);
    const free = layout(nodes, edges);
    const laid = layout(nodes, edges, { ghost: { x: 1, y: 1 } });
    expect(laid.nodes.map((n) => [n.x, n.y])).toEqual(
      free.nodes.map((n) => [n.x, n.y]),
    );
  });

  it("`prev` holds a drawn node in place through an edit — dagre speaks only for the new", () => {
    const { nodes, edges } = buildGraph(uneven);
    const first = layout(nodes, edges);
    const prev = new Map(first.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    // The same graph minus one edge — the kind of change that would re-rank everything.
    const fewer = edges.filter((_, i) => i !== edges.length - 1);
    const second = layout(nodes, fewer, undefined, prev);
    for (const n of second.nodes) {
      const was = prev.get(n.id);
      expect({ x: n.x, y: n.y }).toEqual(was);
    }
  });

  it("a pin outranks `prev` — the file outranks the session", () => {
    const { nodes, edges } = buildGraph(uneven);
    const first = layout(nodes, edges);
    const prev = new Map(first.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const laid = layout(nodes, edges, { comp: { x: 900, y: 700 } }, prev);
    expect(laid.nodes.find((n) => n.module === "comp")).toMatchObject({
      x: 900,
      y: 700,
    });
  });
});

// A receiver never sits above, or level with, what feeds it — even under a PIN. See docs/graphBuild.md.
describe("a receiver stays below what feeds it", () => {
  const chain = graph(
    {
      long: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox"],
  );

  /** Every edge, as `[source, target]` tops and bottoms — what the rule is actually about. */
  const spans = (laid: ReturnType<typeof layout>) => {
    const at = new Map(laid.nodes.map((n) => [n.id, n]));
    return laid.edges.flatMap((e) => {
      const from = at.get(e.source);
      const to = at.get(e.target);
      return from && to && from !== to ? [{ e, from, to }] : [];
    });
  };

  it("holds with no pins at all, which is dagre doing its job", () => {
    const { nodes, edges } = buildGraph(chain);
    for (const { from, to } of spans(layout(nodes, edges)))
      expect(to.y).toBeGreaterThanOrEqual(from.y + from.h);
  });

  it("a pin that would put a module above its input is pushed back down", () => {
    const { nodes, edges } = buildGraph(chain);
    // Straight above the track that feeds it — the one thing a pin could always do before.
    const laid = layout(nodes, edges, { comp: { x: 40, y: -900 } });
    for (const { from, to } of spans(laid))
      expect(to.y, `${from.label} -> ${to.label}`).toBeGreaterThanOrEqual(
        from.y + from.h,
      );
  });

  it("…and one that would put it on the SAME line, which is the subtler half", () => {
    const { nodes, edges } = buildGraph(chain);
    const vox = layout(nodes, edges).nodes.find((n) => n.label === "vox");
    // Exactly level with the track: no cable climbs, and it still reads as a cable going nowhere.
    const laid = layout(nodes, edges, { comp: { x: 400, y: vox?.y ?? 0 } });
    const comp = laid.nodes.find((n) => n.module === "comp");
    expect(comp?.y).toBeGreaterThanOrEqual((vox?.y ?? 0) + (vox?.h ?? 0));
  });

  it("moves it no further than the rule needs, and never sideways", () => {
    const { nodes, edges } = buildGraph(chain);
    const laid = layout(nodes, edges, { comp: { x: 640, y: -900 } });
    const comp = laid.nodes.find((n) => n.module === "comp");
    const vox = laid.nodes.find((n) => n.label === "vox");
    // The x is the half of a pin this has no opinion about, so it survives untouched.
    expect(comp?.x).toBe(640);
    expect(comp?.y).toBe((vox?.y ?? 0) + (vox?.h ?? 0));
  });

  it("leaves a pin that already obeys exactly where it was put", () => {
    const { nodes, edges } = buildGraph(chain);
    const laid = layout(nodes, edges, { comp: { x: 640, y: 4000 } });
    expect(laid.nodes.find((n) => n.module === "comp")).toMatchObject({
      x: 640,
      y: 4000,
    });
  });
});
