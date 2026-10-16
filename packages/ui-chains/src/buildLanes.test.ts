// buildLanes.test.ts — a lane's card in the built graph: orphans, video lanes, live inputs, sub
// lines, and a rack's pads.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  nodeSize,
  PADS_ACROSS,
  PADS_UP,
  RACK_ADD_BIND,
  rackAddBind,
  rackAddBindAt,
  rackBindSymbol,
  rackGrid,
  rackUI,
  TAP_COLS,
  TAP_ROWS,
} from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("orphan tracks", () => {
  it("draws a track no chain mentions, unwired and unlabelled", () => {
    const { nodes, edges } = buildGraph(
      graph(
        {
          lead: {
            from: "vox",
            use: [{ module: "eq" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["vox", "spare"],
      ),
    );
    const spare = nodes.find((n) => n.id === "trk:spare");
    expect(spare).toBeTruthy();
    expect(spare?.kind).toBe("track");
    // No note under the name: the missing cable already says it, and a lane with none still plays.
    expect(spare?.sub).toBeUndefined();
    // Unwired is the point — nothing routes it anywhere.
    expect(
      edges.some((e) => e.source === "trk:spare" || e.target === "trk:spare"),
    ).toBe(false);
  });

  it("leaves a routed track alone — no marker, still wired", () => {
    const { nodes, edges } = buildGraph(
      graph(
        {
          lead: {
            from: "vox",
            use: [{ module: "eq" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["vox"],
      ),
    );
    expect(nodes.find((n) => n.id === "trk:vox")?.sub).toBeUndefined();
    expect(edges.map((e) => `${e.source}->${e.target}`)).toContain(
      "trk:vox->mod:eq",
    );
  });

  it("gives an orphan the same mixer strip and colour as any other track", () => {
    const { nodes } = buildGraph({
      ...graph({}, ["spare"]),
      trackColors: { spare: "#ff5706" },
    });
    const spare = nodes.find((n) => n.id === "trk:spare");
    expect(spare?.color).toBe("#ff5706");
    expect(spare?.ui).toBeTruthy(); // the m/s/a + volume/pan grid
  });

  it("draws a whole song's worth of tracks before any chain exists", () => {
    const { nodes } = buildGraph(graph({}, ["a", "b", "c"]));
    expect(nodes.map((n) => n.id).sort()).toEqual(["trk:a", "trk:b", "trk:c"]);
  });
});

describe("a module's sub line", () => {
  it("says nothing on the first module of a chain", () => {
    const { nodes } = buildGraph(
      graph(
        {
          lead: {
            from: "vox",
            use: [{ module: "eq" }, { module: "verb" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["vox"],
      ),
    );
    expect(nodes.find((n) => n.id === "mod:eq")?.sub).toBeUndefined();
    expect(nodes.find((n) => n.id === "mod:verb")?.sub).toBeUndefined();
  });

  it("still warns when a module is shared across chains", () => {
    // The one case worth a line: editing this module reaches both chains.
    const { nodes } = buildGraph(
      graph(
        {
          lead: {
            from: "vox",
            use: [{ module: "verb" }],
            out: [{ to: "OUT", gain: 1 }],
          },
          pad: {
            from: "keys",
            use: [{ module: "verb" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["vox", "keys"],
      ),
    );
    expect(nodes.find((n) => n.id === "mod:verb")?.sub).toBe("lead, pad");
  });
});

// Video lanes are chain sources like any other, orphans included — only glyph and strip differ.
describe("video tracks", () => {
  const withVideo = (
    chains: WebGraph["chains"],
    tracks: string[],
    videoTracks: string[],
  ): WebGraph => ({ chains, tracks, videoTracks, warnings: [] });

  it("draws an unrouted video lane as an orphan, exactly as an audio one", () => {
    const { nodes } = buildGraph(withVideo({}, ["spare"], ["main"]));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Same kind and the same absence of a note — the two read alike because they mean alike.
    expect(byId["trk:spare"]).toMatchObject({ kind: "track" });
    expect(byId["trk:spare"].sub).toBeUndefined();
    expect(byId["trk:main"]).toMatchObject({ kind: "track", video: true });
    expect(byId["trk:main"].sub).toBeUndefined();
  });

  // A picture lane read as an unknown DESTINATION was drawn as a sink beside itself (docs/graphBuild.md).
  it("lands a cable on the LANE, not on a sink invented for it", () => {
    const { nodes, edges } = buildGraph(
      withVideo(
        { cam: { from: "cam", use: [], out: [{ to: "main", gain: 1 }] } },
        [],
        ["main"],
      ),
    );
    expect(
      nodes.filter((n) => n.kind === "sink").map((n) => n.label),
    ).not.toContain("main");
    expect(edges.find((e) => e.target === "trk:main")).toBeTruthy();
  });

  it("gives a video lane a mute-only strip, not the mixer's five controls", () => {
    const { nodes } = buildGraph(withVideo({}, ["spare"], ["main"]));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Mute and solo, the two words picture HAS — no gain, no pan, and no arm to offer.
    expect(Object.keys(byId["trk:main"].ui?.widgets ?? {})).toEqual([
      "mute",
      "solo",
    ]);
    expect(Object.keys(byId["trk:spare"].ui?.widgets ?? {})).toEqual([
      "mute",
      "solo",
      "arm",
      "vol",
      "pan",
    ]);
  });

  it("routes a video chain and puts PICTURE on the cable", () => {
    const { nodes, edges } = buildGraph(
      withVideo(
        {
          main: {
            from: "main",
            use: [{ module: "blur" }],
            out: [{ to: "VIDEO_OUT", gain: 1 }],
          },
        },
        [],
        ["main"],
      ),
    );
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Routed, and still marked video: the flag is about the SIGNAL, not about being wired.
    expect(byId["trk:main"]).toMatchObject({ kind: "track", video: true });
    expect(byId["trk:main"].sub).toBeUndefined();
    const cable = edges.find((e) => e.source === "trk:main");
    expect(cable?.signal).toBe("video"); // not the audio default
  });
});

// A live input feeds a TRACK, and the arrow has to land on the track node. See docs/graphBuild.md.
describe("an input wired to a track", () => {
  it("draws the arrow to the track, not to its first module", () => {
    const { edges } = buildGraph({
      chains: {
        // The input's own run: one node, landing on the track.
        "IN:in-2": {
          use: [{ module: "IN:in-2" }],
          out: [{ to: "gtr", gain: 1 }],
        },
        // …and the track's own lane, whose first module is the wrong landing for that arrow.
        gtr: {
          from: "gtr",
          use: [{ module: "wah" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["gtr"],
      warnings: [],
    });
    const from = edges.find((e) => e.source === "mod:IN:in-2");
    expect(from?.target).toBe("trk:gtr");
    expect(from?.target).not.toBe("mod:wah");
  });
});

describe("a RACK node draws its sounds", () => {
  const kit = [
    { symbol: "BD", note: 36, clip: "kick" },
    { symbol: "HH", note: 42, clip: "hat" },
    { symbol: "SN", note: 38, clip: "snare" },
  ];

  it("draws an octave as a 4×3 grid, the lowest note bottom left, an empty note an add tap on it", () => {
    const ui = rackUI(kit);
    // 36..47 holds the sounds; 48..59 is offered above them, so a rack can grow upward.
    expect(ui.tabs?.map((t) => t.name)).toEqual(["C2", "C3"]);
    expect(ui.cols).toBe(PADS_ACROSS * TAP_COLS);
    expect(ui.rows).toBe(PADS_UP * TAP_ROWS);
    const c2 = ui.tabs?.[0].widgets ?? {};
    expect(Object.keys(c2)).toHaveLength(12);
    // C (36) is the first cell of the BOTTOM row, D (38) the third, F# (42) the third of the middle one.
    expect(c2["rack:BD"]).toMatchObject({
      type: "tap",
      bind: "@rack:BD",
      col: 0,
      row: 2 * TAP_ROWS,
      colSpan: TAP_COLS,
      rowSpan: TAP_ROWS,
    });
    expect(c2["rack:SN"]).toMatchObject({
      col: 2 * TAP_COLS,
      row: 2 * TAP_ROWS,
    });
    expect(c2["rack:HH"]).toMatchObject({ col: 2 * TAP_COLS, row: TAP_ROWS });
    // B (47) is the last cell of the TOP row, and it adds a sound on its own note.
    expect(c2["rack+:47"]).toMatchObject({
      type: "tap",
      bind: rackAddBindAt(47),
      col: 3 * TAP_COLS,
      row: 0,
    });
    expect(Object.keys(ui.tabs?.[1].widgets ?? {})).toHaveLength(12);
  });

  it("gives an SFZ kit's fixed pads no add taps, a gain under each, and its level beside the grid", () => {
    const ui = rackUI(kit, true);
    // One octave is one page: no tab column for it.
    expect(ui.tabs).toBeUndefined();
    expect(Object.keys(ui.widgets).sort()).toEqual(
      [
        "kit:gain:BD",
        "kit:gain:HH",
        "kit:gain:SN",
        "kit:volume",
        "rack:BD",
        "rack:HH",
        "rack:SN",
      ].sort(),
    );
    expect(ui.rows).toBe(PADS_UP * (TAP_ROWS + 1));
    expect(ui.widgets["kit:volume"]).toMatchObject({
      type: "knob",
      bind: "Volume",
      min: -40,
      max: 12,
      col: PADS_ACROSS * TAP_COLS,
      row: 0,
    });
    expect(ui.widgets["kit:gain:HH"]).toMatchObject({
      type: "number",
      bind: "Key 42",
      min: -24,
      max: 12,
      step: 1,
      col: 2 * TAP_COLS,
      row: TAP_ROWS + 1 + TAP_ROWS,
      rowSpan: 1,
    });
  });

  it("gives a kit over two octaves a tab each, and its level on every tab", () => {
    const ui = rackUI([...kit, { symbol: "CR", note: 49 }], true);
    expect(ui.tabs?.map((t) => t.name)).toEqual(["C2", "C3"]);
    expect(Object.keys(ui.widgets)).toEqual(["kit:volume"]);
    expect(ui.tabs?.[1].widgets["rack:CR"]).toMatchObject({ col: TAP_COLS });
  });

  it("opens an empty rack on the octave its first tap lands in", () => {
    const ui = rackUI([]);
    expect(ui.tabs).toBeUndefined();
    expect(Object.keys(ui.widgets)).toHaveLength(12);
    expect(ui.widgets["rack+:36"]).toMatchObject({ bind: rackAddBindAt(36) });
  });

  it("reads an add bind back to its note, and a bare one to none", () => {
    expect(rackAddBind(rackAddBindAt(40))).toEqual({ note: 40 });
    expect(rackAddBind(RACK_ADD_BIND)).toEqual({ note: null });
    expect(rackAddBind("@rack:BD")).toBeNull();
    expect(rackAddBind("Cutoff")).toBeNull();
  });

  it("is never smaller than 2×2, even holding one sound", () => {
    // Two pads in a row look like two controls; a square looks like a rack with slots free.
    expect(rackGrid(1)).toEqual({ cols: 2, rows: 2 });
    expect(rackGrid(0)).toEqual({ cols: 2, rows: 2 });
    expect(rackGrid(4)).toEqual({ cols: 2, rows: 2 });
  });

  it("stays square-ish as it grows, and never wider than four", () => {
    // 4×2 for eight says less about the instrument than 3×3, and past sixteen the grid only grows down.
    expect(rackGrid(8)).toEqual({ cols: 3, rows: 3 });
    expect(rackGrid(9)).toEqual({ cols: 3, rows: 3 });
    expect(rackGrid(16)).toEqual({ cols: 4, rows: 4 });
    expect(rackGrid(24)).toEqual({ cols: 4, rows: 6 });
  });

  it("reads a pad bind back to its symbol, and leaves every other bind alone", () => {
    // The renderer routes on this: a pad FIRES, where `@mute` and a plain param SET.
    expect(rackBindSymbol("@rack:BD")).toBe("BD");
    expect(rackBindSymbol("@mute")).toBeNull();
    expect(rackBindSymbol("Cutoff")).toBeNull();
    expect(rackBindSymbol(undefined)).toBeNull();
  });

  it("puts the pads on the node, and sizes it to them", () => {
    const g = buildGraph(
      graph(
        {
          beat: {
            from: "beat",
            use: [{ module: "kit", rack: kit }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["beat"],
      ),
    );
    const node = g.nodes.find((n) => n.module === "kit");
    expect(node?.rack).toHaveLength(3);
    expect(Object.keys(node?.ui?.tabs?.[0].widgets ?? {})).toContain("rack:BD");
    expect(node?.w).toBe(nodeSize(rackUI(kit)).w);
  });

  it("leaves an AUTHORED panel alone — the file has said what the node shows", () => {
    const own = {
      cols: 1,
      rows: 1,
      widgets: {
        g: { type: "knob", col: 0, row: 0, bind: "Gain" } as WebWidget,
      },
    };
    const g = buildGraph(
      graph(
        {
          beat: {
            from: "beat",
            use: [{ module: "kit", rack: kit, ui: own }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["beat"],
      ),
    );
    const node = g.nodes.find((n) => n.module === "kit");
    expect(Object.keys(node?.ui?.widgets ?? {})).toEqual(["g"]);
  });
});
