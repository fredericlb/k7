// moduleRowLane.test.ts — a module row led by its lane's own card and what feeds it.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, moduleRow, trackInputs } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

/** The lane's own card at the head of its row — what a double-click on a track header draws. */
describe("moduleRow led by its lane", () => {
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

  it("puts the lane FIRST — the signal starts there", () => {
    const row = moduleRow(lane, ["comp", "eq"], { links: true, track: "vox" });
    expect(row.nodes.map((n) => n.id)).toEqual([
      "trk:vox",
      "mod:comp",
      "mod:eq",
    ]);
  });

  it("puts what FEEDS the lane before it — an input, and a preamp past it", () => {
    const fed = graph(
      {
        ...lane.chains,
        mic: {
          use: [{ module: "in", monitor: "on" }],
          out: [{ to: "pre", gain: 1 }],
        },
        pre: { use: [{ module: "pre" }], out: [{ to: "vox", gain: 1 }] },
      },
      ["vox"],
    );
    const inputs = trackInputs(fed, "vox");
    expect(inputs).toEqual(["in", "pre"]);
    const row = moduleRow(fed, ["comp", "eq"], {
      links: true,
      track: "vox",
      inputs,
    });
    expect(row.nodes.map((n) => n.id)).toEqual([
      "mod:in",
      "mod:pre",
      "trk:vox",
      "mod:comp",
      "mod:eq",
    ]);
    expect(row.edges).toContainEqual(
      expect.objectContaining({ source: "mod:pre", target: "trk:vox" }),
    );
    // A lane nothing feeds has nothing before it, and a lane's own `from` is never taken for an input.
    expect(trackInputs(lane, "vox")).toEqual([]);
  });

  it("carries the cable OUT of the lane, which the row could not draw without it", () => {
    const row = moduleRow(lane, ["comp", "eq"], { links: true, track: "vox" });
    expect(row.edges).toContainEqual(
      expect.objectContaining({ source: "trk:vox", target: "mod:comp" }),
    );
  });

  it("drops the lane's clip LIST, which would set the height of every card beside it", () => {
    const withClips: WebGraph = {
      ...lane,
      trackClips: {
        vox: [{ ref: "riff", start: 0, tc: "1:1:1", len: 4, kind: "audio" }],
      },
    };
    const row = moduleRow(withClips, ["comp", "eq"], {
      links: true,
      track: "vox",
    });
    expect(row.nodes[0].clips).toBeUndefined();
    // …and the row is as tall as its tallest MODULE, which is what the clip list would have grown past.
    expect(new Set(row.nodes.map((n) => n.h)).size).toBe(1);
  });

  it("as drawn, keeps every card's own width and the lane's clips, every card the tallest's height", () => {
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
    const withClips: WebGraph = {
      ...tall,
      trackClips: {
        vox: [{ ref: "riff", start: 0, tc: "1:1:1", len: 4, kind: "audio" }],
      },
    };
    const full = buildGraph(withClips).nodes;
    const row = moduleRow(withClips, ["comp", "eq"], {
      links: true,
      track: "vox",
      asDrawn: true,
    });
    for (const n of row.nodes) {
      const g = full.find((f) => f.id === n.id);
      expect(n.w).toBe(g?.w);
    }
    expect(row.nodes[0].clips).toBeDefined();
    // One band: every card the tallest's height, all on one top line, so the row fills the pane's height.
    const tallest = Math.max(
      ...full
        .filter((f) => row.nodes.some((n) => n.id === f.id))
        .map((f) => f.h),
    );
    expect(new Set(row.nodes.map((n) => n.h))).toEqual(new Set([tallest]));
    expect(new Set(row.nodes.map((n) => n.y)).size).toBe(1);
    // The box is the cards' height and no more, so a height fit makes the tallest card fill the view.
    expect(row.height - row.top).toBe(Math.max(...row.nodes.map((n) => n.h)));
  });

  it("builds its cards with the machine's lists, so a MIDI device's dropdown offers them here too", () => {
    const keys = graph(
      {
        vox: {
          from: "vox",
          use: [{ module: "keys", device: "" }, { module: "comp" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["vox"],
    );
    const row = moduleRow(keys, ["keys", "comp"], {
      asDrawn: true,
      devices: { midiDevices: ["KeyStep 37"] },
    });
    const card = row.nodes.find((n) => n.module === "keys");
    const options = card?.ui?.widgets.device?.options?.map((o) => o.label);
    expect(options).toEqual(["any", "KeyStep 37"]);
  });

  it("names the lane by KIND, so a module of the same name is not mistaken for it", () => {
    const clash = graph(
      {
        vox: {
          from: "vox",
          use: [{ module: "vox" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      ["vox"],
    );
    const row = moduleRow(clash, ["vox"], { links: true, track: "vox" });
    expect(row.nodes.map((n) => n.id)).toEqual(["trk:vox", "mod:vox"]);
  });

  it("draws no lone lane: a row with no module is not a signal path", () => {
    // The pane says 'this lane reaches no module' instead, which is the honest answer to a double-click.
    expect(moduleRow(lane, [], { links: true, track: "vox" }).nodes).toEqual(
      [],
    );
  });

  it("leaves the row alone when no lane is named", () => {
    expect(
      moduleRow(lane, ["comp", "eq"], { links: true }).nodes.map((n) => n.id),
    ).toEqual(["mod:comp", "mod:eq"]);
  });
});
