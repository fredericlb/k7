// subgraph.test.ts — one lane's slice of the routing graph.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, subgraphForTrack, trackModules } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("subgraphForTrack", () => {
  it("keeps only the chains a track's signal actually flows through", () => {
    const g = graph(
      {
        lead: {
          from: "melody",
          use: [{ module: "s" }],
          out: [{ to: "OUT", gain: 1 }],
        },
        low: {
          from: "bass",
          use: [{ module: "s" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["melody", "bass"],
    );
    const sub = subgraphForTrack(g, "melody");
    expect(Object.keys(sub.chains)).toEqual(["lead"]);
    expect(sub.tracks).toEqual(["melody"]);
  });

  it("carries curves through, so the panel draws automation nodes too", () => {
    const g: WebGraph = {
      chains: {
        lead: {
          from: "melody",
          use: [
            { module: "s", automations: [{ param: "Cutoff", curve: "sweep" }] },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["melody"],
      curves: { sweep: { type: "custom" } },
      warnings: [],
    };
    const sub = subgraphForTrack(g, "melody");
    expect(sub.curves).toEqual({ sweep: { type: "custom" } });
    const { nodes } = buildGraph(sub);
    expect(nodes.find((n) => n.kind === "curve")).toMatchObject({
      label: "sweep",
    });
  });
});

describe("trackModules", () => {
  // What a lane's row is made of: the modules its signal reaches, and the ORDER is the contribution.
  const song = graph(
    {
      vox: {
        from: "vox",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [
          { to: "OUT", gain: 1 },
          { to: "reverb", gain: 0.3 },
        ],
      },
      reverb: {
        use: [{ module: "conv" }],
        out: [{ to: "OUT", gain: 1 }],
      },
      bass: {
        from: "bass",
        use: [{ module: "drive" }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    ["vox", "bass"],
  );

  it("lists them in signal order, its own chain first", () => {
    expect(trackModules(song, "vox")).toEqual(["comp", "eq", "conv"]);
  });

  it("follows a send out of the lane's own chain", () => {
    // `conv` is in the reverb chain vox feeds — the same reach the graph frames for that track.
    expect(trackModules(song, "vox")).toContain("conv");
    expect(trackModules(song, "bass")).toEqual(["drive"]);
  });

  it("says nothing for a lane no chain takes as its source", () => {
    expect(trackModules(song, "gone")).toEqual([]);
  });

  it("draws a shared module once", () => {
    const shared = graph(
      {
        a: {
          from: "vox",
          use: [{ module: "glue" }],
          out: [{ to: "b", gain: 1 }],
        },
        b: { use: [{ module: "glue" }], out: [{ to: "OUT", gain: 1 }] },
      },
      ["vox"],
    );
    // Two chains naming one module is one card: two would offer two sets of controls for one thing.
    expect(trackModules(shared, "vox")).toEqual(["glue"]);
  });
});
