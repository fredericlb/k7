// The STACK view: a column per lane, edge to edge and as wide as its widest card, with the inputs and
// outputs as full-width bars. What is pinned is that geometry — the drawing reads it and nothing else.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, cablePath } from "./graph";
import { stackLayout } from "./stackLayout";

// Two lanes, one with two modules and one with one, a live input feeding the first, a limiter on the master run.
const g: WebGraph = {
  chains: {
    lead: {
      from: "melody",
      use: [
        { module: "synth", ui: { cols: 6, rows: 2, widgets: {} } },
        { module: "verb" },
      ],
      out: [{ to: "MIX", gain: 1 }],
    },
    low: {
      from: "bass",
      use: [{ module: "amp" }],
      out: [{ to: "MIX", gain: 1 }],
    },
    mic: {
      from: "",
      use: [{ module: "IN", monitor: "on" }],
      out: [{ to: "melody", gain: 1 }],
    },
    master: {
      from: "MIX",
      use: [{ module: "limiter" }],
      out: [{ to: "OUT", gain: 1 }],
    },
  },
  tracks: ["melody", "bass"],
  warnings: [],
} as unknown as WebGraph;

const laid = () => {
  const { nodes, edges } = buildGraph(g);
  return stackLayout(nodes, edges, g, ["melody", "bass"]);
};
const at = (l: ReturnType<typeof laid>, module: string) =>
  l.nodes.find((n) => n.module === module);

describe("the stack view", () => {
  it("puts each lane's modules under its own card, in the lanes' order, with no air between them", () => {
    const l = laid();
    const lane = at(l, "melody");
    const synth = at(l, "synth");
    const verb = at(l, "verb");
    expect(synth?.x).toBe(lane?.x);
    expect(synth?.y).toBe((lane?.y ?? 0) + (lane?.h ?? 0));
    expect(verb?.y).toBe((synth?.y ?? 0) + (synth?.h ?? 0));
    // The second lane is a column to the right of the first.
    expect(at(l, "bass")?.x).toBeGreaterThan((lane?.x ?? 0) + (lane?.w ?? 0));
    expect(at(l, "amp")?.x).toBe(at(l, "bass")?.x);
  });

  it("makes every card of a column as wide as its widest", () => {
    const l = laid();
    const col = ["melody", "synth", "verb"].map((m) => at(l, m)?.w);
    expect(new Set(col).size).toBe(1);
    expect(col[0]).toBe(
      Math.max(
        ...buildGraph(g)
          .nodes.filter((n) =>
            ["melody", "synth", "verb"].includes(n.module ?? ""),
          )
          .map((n) => n.w),
      ),
    );
  });

  it("draws an input over the lane it feeds, as wide as that lane's column", () => {
    const l = laid();
    const input = at(l, "IN");
    const lane = at(l, "melody");
    expect(input?.bar).toBe(true);
    expect([input?.x, input?.w]).toEqual([lane?.x, lane?.w]);
    expect((input?.y ?? 0) + (input?.h ?? 0)).toBeLessThan(lane?.y ?? 0);
    // …and every lane's card still on one line, whether an input stands over it or not.
    expect(at(l, "bass")?.y).toBe(lane?.y);
  });

  it("gives the MIX the LAST column, the master run and OUT stacked under it like any module", () => {
    const l = laid();
    const mix = l.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    const out = l.nodes.find((n) => n.kind === "sink" && n.label === "OUT");
    const limiter = at(l, "limiter");
    expect(mix?.bar).toBeUndefined();
    expect(out?.bar).toBeUndefined();
    expect(mix?.y).toBe(at(l, "melody")?.y);
    expect(mix?.x).toBe(Math.max(...l.nodes.map((n) => n.x)));
    expect([limiter?.x, out?.x]).toEqual([mix?.x, mix?.x]);
    expect(limiter?.y).toBe((mix?.y ?? 0) + (mix?.h ?? 0));
    expect(out?.y).toBe((limiter?.y ?? 0) + (limiter?.h ?? 0));
    // …OUT as wide as its column, not the whole stack.
    expect(out?.w).toBe(mix?.w);
  });

  it("keeps every cable, for the router to hang from the new places", () => {
    expect(laid().edges.length).toBe(buildGraph(g).edges.length);
  });
});

// A FORK: the synth feeds two chains, a delay and a reverb, both of which land in its lane's column.
describe("a fork in the stack view", () => {
  const fork: WebGraph = {
    chains: {
      lead: {
        from: "melody",
        use: [{ module: "synth" }],
        out: [
          { to: "wet", gain: 1 },
          { to: "space", gain: 1 },
        ],
      },
      wet: { use: [{ module: "dly" }], out: [{ to: "MIX", gain: 1 }] },
      space: { use: [{ module: "rev" }], out: [{ to: "MIX", gain: 1 }] },
    },
    tracks: ["melody"],
    warnings: [],
  } as unknown as WebGraph;
  const forked = () => {
    const { nodes, edges } = buildGraph(fork);
    return stackLayout(nodes, edges, fork, ["melody"]);
  };
  const id = (l: ReturnType<typeof forked>, m: string) =>
    l.nodes.find((n) => n.module === m)?.id;

  it("sends the cable that skips cards round the column's side, and only that one", () => {
    const l = forked();
    const synth = id(l, "synth");
    const fromSynth = l.edges.filter((e) => e.source === synth);
    expect(fromSynth).toHaveLength(2);
    // One target is stacked right under the synth and needs no lane; the other is further down.
    expect(fromSynth.filter((e) => e.side !== undefined)).toHaveLength(1);
    expect(fromSynth.find((e) => e.side !== undefined)?.side).toBe(0);
  });

  it("gives the forking card its output sockets back, and no other card any", () => {
    const l = forked();
    const synth = l.nodes.find((n) => n.module === "synth");
    expect(synth?.jacks?.out.length).toBeGreaterThan(0);
    expect(synth?.jacks?.in).toEqual([]);
    expect(l.nodes.find((n) => n.module === "dly")?.jacks).toBeUndefined();
  });

  it("draws a side cable out of the right edge and into the right edge", () => {
    const l = forked();
    const e = l.edges.find((x) => x.side !== undefined);
    const src = l.nodes.find((n) => n.id === e?.source);
    const tgt = l.nodes.find((n) => n.id === e?.target);
    const path = e && cablePath(e, src, tgt);
    expect(path?.[0].x).toBe((src?.x ?? 0) + (src?.w ?? 0));
    expect(path?.[path.length - 1].x).toBe((tgt?.x ?? 0) + (tgt?.w ?? 0));
    // …and the run down the lane is OUTSIDE the column.
    expect(Math.max(...(path ?? []).map((p) => p.x))).toBeGreaterThan(
      (src?.x ?? 0) + (src?.w ?? 0),
    );
  });
});
