import type { WebGraph, WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  alignModuleRank,
  buildGraph,
  CELL,
  HEADER_MAX_PX,
  HEADER_MIN_PX,
  headerFontPx,
  jackPoint,
  layout,
  masterRunAside,
  moduleDisplayName,
  moduleRow,
  NODE_H,
  NODE_MIN_W,
  NODE_W,
  nodeSize,
  pushBelowInputs,
  RACK_ADD_BIND,
  rackBindSymbol,
  rackGrid,
  rackUI,
  spaceModulesEvenly,
  subgraphForTrack,
  TAP_COLS,
  TAP_ROWS,
  trackModules,
  UI_PAD,
  widgetDenorm,
  widgetNorm,
  widgetRange,
  widgetTyped,
} from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("buildGraph", () => {
  // Every page load starts empty, and dagre reports -Infinity for that — see docs/graphBuild.md.
  it("reports zero extent for an empty layout, never -Infinity", () => {
    const { nodes, width, height } = layout([], []);
    expect(nodes).toHaveLength(0);
    expect(Number.isFinite(width)).toBe(true);
    expect(Number.isFinite(height)).toBe(true);
    expect(width).toBe(0);
    expect(height).toBe(0);
  });

  it("wires track -> module -> sink for a one-module chain", () => {
    const { nodes, edges } = buildGraph(
      graph(
        {
          lead: {
            from: "melody",
            use: [{ module: "synth" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["melody"],
      ),
    );
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId["trk:melody"]?.kind).toBe("track");
    expect(byId["mod:synth"]).toMatchObject({
      kind: "module",
      label: "synth",
      chain: "lead",
      chains: ["lead"],
    });
    expect(byId["snk:OUT"]?.kind).toBe("sink");
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      "mod:synth->snk:OUT",
      "trk:melody->mod:synth",
    ]);
  });

  it("labels an out edge with its non-unity gain as a percentage", () => {
    const { edges } = buildGraph(
      graph({ a: { use: [{ module: "x" }], out: [{ to: "OUT", gain: 0.3 }] } }),
    );
    expect(edges.find((e) => e.target === "snk:OUT")?.label).toBe("30%");
  });

  it("renders an empty chain as a single pass-through node", () => {
    const { nodes } = buildGraph(
      graph({ bus: { use: [], out: [{ to: "OUT", gain: 1 }] } }),
    );
    expect(nodes.find((n) => n.id === "chn:bus")).toMatchObject({
      kind: "chain",
    });
  });

  // The mixer's sum is IMPLICIT: what is drawn is the run that leaves it. See docs/graphBuild.md.
  describe("the sum", () => {
    // A song as the scaffolds write one: two lanes into MIX, and the master run declared empty.
    const song = (): WebGraph =>
      graph(
        {
          melody: {
            from: "melody",
            use: [{ module: "lead" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          pad: {
            from: "pad",
            use: [{ module: "synth-pad" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
        },
        ["melody", "pad"],
      );

    it("draws no cable from a lane's chain into MIX", () => {
      const { edges } = buildGraph(song());
      expect(edges.filter((e) => e.target === "snk:MIX")).toEqual([]);
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "snk:MIX->snk:OUT",
        "trk:melody->mod:lead",
        "trk:pad->mod:synth-pad",
      ]);
    });

    // Two cards otherwise: `from: MIX` falls through to the track branch. docs/graphBuild.md.
    it("draws MIX once, as a sink, with the master run leaving it", () => {
      const { nodes } = buildGraph(song());
      expect(nodes.filter((n) => n.label === "MIX").map((n) => n.id)).toEqual([
        "snk:MIX",
      ]);
      expect(nodes.find((n) => n.id === "snk:MIX")?.kind).toBe("sink");
    });

    it("puts the master chain's modules between MIX and OUT", () => {
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { edges } = buildGraph(g);
      expect(
        edges
          .filter((e) => e.source.startsWith("snk:") || e.target === "snk:OUT")
          .map((e) => `${e.source}->${e.target}`)
          .sort(),
      ).toEqual(["mod:eq->snk:OUT", "snk:MIX->mod:comp"]);
    });

    // A sink's rank is the wrong end of the page for a sum: the master run LEAVES it.
    it("ranks the whole master run AFTER every lane, in its own order", () => {
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { nodes } = buildGraph(g);
      const rank = (id: string) => nodes.find((n) => n.id === id)?.rank ?? 0;
      // MIX used to be rank 0 — the track row — leaving its one drawn cable to span the page.
      const lanes = nodes.filter(
        (n) => n.kind === "module" && n.id !== "mod:comp",
      );
      expect(rank("snk:MIX")).toBeGreaterThan(
        Math.max(...lanes.map((n) => n.rank ?? 0)),
      );
      // …and the run keeps its own order inside that: sum, its modules, then the output.
      expect(rank("snk:MIX")).toBeLessThan(rank("mod:comp"));
      expect(rank("mod:comp")).toBeLessThan(rank("snk:OUT"));
    });

    it("does not rank a master module by its place INSIDE the run", () => {
      // `comp` is step 0 of the master chain. Ranked by that it would land on the first module row,
      // up among the lanes — which is the same disease the sum's own rank 0 was.
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { nodes } = buildGraph(g);
      const comp = nodes.find((n) => n.id === "mod:comp");
      const lanes = nodes.filter(
        (n) => n.kind === "module" && n.id !== "mod:comp",
      );
      expect(comp?.rank).toBeGreaterThan(
        Math.max(...lanes.map((n) => n.rank ?? 0)),
      );
    });

    // The mixer view pushes every sink under the strip row, and a SUM is not one of them: it keeps
    // the rank it was given rather than being shoved past the strips with the outputs.
    it("does not push MIX when the strips are aligned", () => {
      const { nodes } = buildGraph(song());
      const was = nodes.find((n) => n.id === "snk:MIX")?.rank;
      const aligned = alignModuleRank(nodes, ["lead", "synth-pad"]);
      const rank = (id: string) => aligned.find((n) => n.id === id)?.rank;
      expect(rank("snk:MIX")).toBe(was);
      expect(rank("snk:MIX")).toBeLessThan(rank("snk:OUT") ?? 0);
    });

    // Sockets: nothing may ARRIVE at the sum, and the master run leaves by its output.
    it("gives MIX an output socket and no input", () => {
      const { nodes } = buildGraph(song());
      const mix = nodes.find((n) => n.id === "snk:MIX");
      expect(mix?.jacks?.in).toEqual([]);
      expect(mix?.jacks?.out).toHaveLength(1);
      expect(nodes.find((n) => n.id === "snk:OUT")?.jacks?.out).toEqual([]);
    });

    // A project written before `MIX: [ OUT ]` declares no master run, so the pair is drawn anyway.
    it("draws MIX -> OUT even when the file declares no master run", () => {
      const { nodes, edges } = buildGraph(
        graph(
          {
            melody: {
              from: "melody",
              use: [{ module: "lead" }],
              out: [{ to: "MIX", gain: 1 }],
            },
          },
          ["melody"],
        ),
      );
      expect(nodes.find((n) => n.id === "snk:MIX")?.kind).toBe("sink");
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "snk:MIX->snk:OUT",
        "trk:melody->mod:lead",
      ]);
    });

    // …and a host that wants no OUT card gets none, sum included: half a wire is worse than neither end.
    it("leaves OUT out of that pair when drawMainOut is off", () => {
      const { nodes, edges } = buildGraph(
        graph({
          melody: { use: [{ module: "lead" }], out: [{ to: "MIX", gain: 1 }] },
        }),
        { drawMainOut: false },
      );
      expect(nodes.find((n) => n.id === "snk:OUT")).toBeUndefined();
      expect(edges.filter((e) => e.source === "snk:MIX")).toEqual([]);
    });
  });

  // The PICTURE's pair: the same rules, a different signal, no special case. @studio/song's docs/videoOutputs.md.
  describe("the picture's sum", () => {
    // A video project as the open path leaves one, with the song's own pair beside it.
    const film = (): WebGraph => ({
      ...graph(
        {
          melody: {
            from: "melody",
            use: [{ module: "lead" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          pad: {
            from: "pad",
            use: [{ module: "synth-pad" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
          main: {
            from: "main",
            use: [{ module: "grade" }],
            out: [{ to: "RENDER", gain: 1 }],
          },
          pip: {
            from: "pip",
            use: [{ module: "corner" }],
            out: [{ to: "RENDER", gain: 1 }],
          },
          RENDER: {
            from: "RENDER",
            use: [],
            out: [{ to: "VIDEO_OUT", gain: 1 }],
          },
        },
        ["melody", "pad"],
      ),
      videoTracks: ["main", "pip"],
    });

    // The mixer's rule — no cable into the sum — stops at MIX. A picture has a handful of sources
    // rather than one per lane, and left implicit a camera hangs off nothing while the compositor
    // reads as unfed; that is the whole of the picture half in a `live-video` rig.
    it("DRAWS each video chain's cable into RENDER, and still none into MIX", () => {
      const { edges } = buildGraph(film());
      expect(edges.filter((e) => e.target === "snk:MIX")).toEqual([]);
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "mod:corner->snk:RENDER",
        "mod:grade->snk:RENDER",
        "snk:MIX->snk:OUT",
        "snk:RENDER->snk:VIDEO_OUT",
        "trk:main->mod:grade",
        "trk:melody->mod:lead",
        "trk:pad->mod:synth-pad",
        "trk:pip->mod:corner",
      ]);
    });

    it("draws RENDER once, as a sink, with the video master run leaving it", () => {
      const { nodes } = buildGraph(film());
      expect(
        nodes.filter((n) => n.label === "RENDER").map((n) => n.id),
      ).toEqual(["snk:RENDER"]);
      expect(nodes.find((n) => n.id === "snk:RENDER")?.kind).toBe("sink");
    });

    it("carries PICTURE on the wire out of it", () => {
      // The one thing that differs from the audio pair, and what makes the run read as picture.
      const { edges } = buildGraph(film());
      expect(edges.find((e) => e.source === "snk:RENDER")?.signal).toBe(
        "video",
      );
      expect(edges.find((e) => e.source === "snk:MIX")?.signal).toBe("audio");
    });

    it("puts the video master chain's modules between RENDER and VIDEO_OUT", () => {
      const g = film();
      g.chains.RENDER = {
        from: "RENDER",
        use: [{ module: "blur" }],
        out: [{ to: "VIDEO_OUT", gain: 1 }],
      };
      const { edges } = buildGraph(g);
      expect(
        edges
          .filter(
            (e) => e.source === "snk:RENDER" || e.target === "snk:VIDEO_OUT",
          )
          .map((e) => `${e.source}->${e.target}`)
          .sort(),
      ).toEqual(["mod:blur->snk:VIDEO_OUT", "snk:RENDER->mod:blur"]);
    });

    it("gives VIDEO_OUT no fader — a frame has no level", () => {
      // `OUT` is the one built-in name carrying a param, so the symmetry stops exactly here.
      const { nodes } = buildGraph(film(), { mainOutVolume: -6 });
      expect(nodes.find((n) => n.id === "snk:OUT")?.ui).toBeDefined();
      expect(nodes.find((n) => n.id === "snk:VIDEO_OUT")?.ui).toBeUndefined();
      expect(
        nodes.find((n) => n.id === "snk:VIDEO_OUT")?.params,
      ).toBeUndefined();
    });

    it("does not push RENDER when the strips are aligned", () => {
      const { nodes } = buildGraph(film());
      const was = nodes.find((n) => n.id === "snk:RENDER")?.rank;
      const aligned = alignModuleRank(nodes, ["lead", "synth-pad"]);
      const rank = (id: string) => aligned.find((n) => n.id === id)?.rank;
      expect(rank("snk:RENDER")).toBe(was);
      expect(rank("snk:RENDER")).toBeLessThan(rank("snk:VIDEO_OUT") ?? 0);
    });

    // The editor re-parses on every keystroke, so a half-typed graph must not lose the card.
    it("draws RENDER -> VIDEO_OUT even when the file declares no video master run", () => {
      const g = film();
      delete g.chains.RENDER;
      const { nodes, edges } = buildGraph(g);
      expect(nodes.find((n) => n.id === "snk:RENDER")?.kind).toBe("sink");
      expect(
        edges.some(
          (e) => `${e.source}->${e.target}` === "snk:RENDER->snk:VIDEO_OUT",
        ),
      ).toBe(true);
    });

    it("leaves VIDEO_OUT out of that pair when drawMainOut is off", () => {
      // `drawMainOut` means "do not draw where the signal leaves", picture and sound alike.
      const { nodes, edges } = buildGraph(film(), { drawMainOut: false });
      expect(nodes.find((n) => n.id === "snk:VIDEO_OUT")).toBeUndefined();
      expect(nodes.find((n) => n.id === "snk:OUT")).toBeUndefined();
      expect(edges.filter((e) => e.source === "snk:RENDER")).toEqual([]);
    });

    it("leaves a song with no picture untouched — neither name appears", () => {
      const { nodes } = buildGraph(
        graph(
          {
            melody: {
              from: "melody",
              use: [{ module: "lead" }],
              out: [{ to: "MIX", gain: 1 }],
            },
            MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
          },
          ["melody"],
        ),
      );
      expect(nodes.some((n) => n.label === "RENDER")).toBe(false);
      expect(nodes.some((n) => n.label === "VIDEO_OUT")).toBe(false);
    });
  });

  it("adds a purple curve node + automation edge per binding, targeting a widget", () => {
    const ui = {
      cols: 2,
      rows: 1,
      widgets: {
        cut: { type: "knob" as const, col: 0, row: 0, bind: "Filter Freq" },
      },
    };
    const { nodes, edges } = buildGraph({
      chains: {
        lead: {
          use: [
            {
              module: "synth",
              ui,
              automations: [
                { param: "Filter Freq", curve: "sweep" }, // has a widget
                { param: "Osc1 Tune", curve: "wobble" }, // no widget
              ],
            },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: [],
      curves: {
        sweep: { type: "custom" },
        wobble: { type: "lfo", shape: "triangle" },
      },
      warnings: [],
    });
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // One curve node per BINDING: the id carries it, the label does not. See docs/graphBuild.md.
    expect(byId["crv:sweep@synth:Filter Freq"]).toMatchObject({
      kind: "curve",
      label: "sweep",
      sub: "custom",
    });
    expect(byId["crv:wobble@synth:Osc1 Tune"]).toMatchObject({
      kind: "curve",
      label: "wobble",
      sub: "lfo triangle",
    });
    // The widget-bound automation carries a node-local widget offset; the other doesn't.
    const withWidget = edges.find((e) => e.source.startsWith("crv:sweep@"));
    const noWidget = edges.find((e) => e.source.startsWith("crv:wobble@"));
    expect(withWidget?.target).toBe("mod:synth");
    expect(withWidget?.automation).toMatchObject({ param: "Filter Freq" });
    expect(withWidget?.automation?.widget).toBeTruthy();
    expect(noWidget?.automation).toMatchObject({ param: "Osc1 Tune" });
    expect(noWidget?.automation?.widget).toBeUndefined();
  });

  it("a curve driving two params is ONE node with two edges — a node, not a stamp", () => {
    const { nodes, edges } = buildGraph({
      chains: {
        lead: {
          use: [
            {
              module: "synth",
              automations: [
                { param: "Filter Freq", curve: "sweep" },
                { param: "Osc1 Tune", curve: "sweep" },
              ],
            },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: [],
      curves: { sweep: { type: "custom" } },
      warnings: [],
    });
    // TWO nodes, one per binding, and not one per curve. See docs/graphBuild.md.
    expect(nodes.filter((n) => n.kind === "curve")).toHaveLength(2);
    expect(edges.filter((e) => e.source.startsWith("crv:sweep@"))).toHaveLength(
      2,
    );
    expect(nodes.filter((n) => n.kind === "curve").map((n) => n.label)).toEqual(
      ["sweep", "sweep"],
    );
  });

  it("skips an automation whose curve is missing from the graph", () => {
    const { nodes } = buildGraph({
      chains: {
        lead: {
          use: [{ module: "s", automations: [{ param: "P", curve: "gone" }] }],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: [],
      curves: {}, // 'gone' isn't here
      warnings: [],
    });
    expect(nodes.find((n) => n.kind === "curve")).toBeUndefined();
  });

  it("keeps the track input when a chain is named after its source track", () => {
    // `from` naming a track that is ALSO a chain name must resolve to the TRACK. docs/graphBuild.md.
    const { nodes, edges } = buildGraph(
      graph(
        { drums: { from: "drums", use: [], out: [{ to: "OUT", gain: 1 }] } },
        ["drums"],
      ),
    );
    expect(nodes.find((n) => n.id === "trk:drums")?.kind).toBe("track");
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      "chn:drums->snk:OUT",
      "trk:drums->chn:drums",
    ]);
  });

  // A splitter feeds one target from two outputs: the pair is not a cable's identity, the socket is.
  it("keeps two cables when one source feeds a target from two ports", () => {
    const { edges } = buildGraph(
      graph({
        sep: {
          from: "stems",
          use: [],
          out: [
            { to: "mix", gain: 1, fromPort: "drums" },
            { to: "mix", gain: 1, fromPort: "bass" },
          ],
        },
        mix: { use: [], out: [{ to: "OUT", gain: 1 }] },
      }),
    );
    const toMix = edges.filter((e) => e.target === "chn:mix");
    expect(toMix).toHaveLength(2);
    expect(toMix.map((e) => e.sourcePort).sort()).toEqual(["bass", "drums"]);
    // Distinct ids, or the renderer keys two cables to one element.
    expect(new Set(toMix.map((e) => e.id)).size).toBe(2);
  });

  // …and the other half of the same key: one link expressed from BOTH ends is still one cable.
  it("collapses a link expressed from both ends, and keeps its port", () => {
    const { edges } = buildGraph(
      graph({
        a: { use: [], out: [{ to: "b", gain: 1, fromPort: "left" }] },
        b: { from: "a", use: [], out: [{ to: "OUT", gain: 1 }] },
      }),
    );
    const ab = edges.filter(
      (e) => e.source === "chn:a" && e.target === "chn:b",
    );
    expect(ab).toHaveLength(1);
    expect(ab[0].sourcePort).toBe("left");
  });
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

describe("widgetNorm / widgetDenorm round-trip", () => {
  const linear: WebWidget = { type: "knob", col: 0, row: 0, min: 0, max: 100 };
  const log: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    min: 20,
    max: 20000,
    curve: "log",
  };

  it("is identity for a linear control", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      expect(widgetNorm(linear, widgetDenorm(linear, t))).toBeCloseTo(t, 9);
  });

  it("is identity for a log control", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      expect(widgetNorm(log, widgetDenorm(log, t))).toBeCloseTo(t, 9);
  });

  it("defaults an unspecified range to 0..1 (normalised plugin params)", () => {
    expect(widgetRange({ type: "knob", col: 0, row: 0 })).toEqual([0, 1]);
  });

  it("quantises to `step` when set", () => {
    const stepped: WebWidget = {
      type: "knob",
      col: 0,
      row: 0,
      min: 0,
      max: 10,
      step: 1,
    };
    expect(Number.isInteger(widgetDenorm(stepped, 0.57))).toBe(true);
  });
});

describe("widgetTyped", () => {
  const w: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    min: -24,
    max: 24,
    step: 1,
  };

  it("takes what is typed, with either decimal mark", () => {
    expect(widgetTyped({ type: "knob", col: 0, row: 0 }, "0.25")).toBe(0.25);
    expect(widgetTyped({ type: "knob", col: 0, row: 0 }, " 0,5 ")).toBe(0.5);
  });

  it("clamps to the control's range and rounds to its step", () => {
    expect(widgetTyped(w, "99")).toBe(24);
    expect(widgetTyped(w, "-99")).toBe(-24);
    expect(widgetTyped(w, "7.4")).toBe(7);
  });

  it("answers null for anything that is not a number, so nothing is sent", () => {
    expect(widgetTyped(w, "")).toBeNull();
    expect(widgetTyped(w, "loud")).toBeNull();
  });
});

describe("nodeSize", () => {
  it("is the plain size with no UI, and grows to fit a UI grid", () => {
    expect(nodeSize(undefined)).toEqual({ w: NODE_W, h: NODE_H });
    expect(nodeSize({ cols: 4, rows: 3, widgets: {} }).h).toBeGreaterThan(
      NODE_H,
    );
  });

  it("is its GRID's width, not the no-panel minimum", () => {
    // NODE_W as a floor would park dead space beside every grid narrower than it.
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBe(
      UI_PAD * 2 + 2 * CELL,
    );
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBeLessThan(NODE_W);
  });

  it("still leaves the header something to be drawn in", () => {
    // The one case the grid alone cannot answer: one column is 48px, all of it header padding and glyph.
    expect(nodeSize({ cols: 1, rows: 2, widgets: {} }).w).toBe(NODE_MIN_W);
  });
});

// A cable is coloured by what its SOURCE emits, so the signal path reads at a glance. docs/graphBuild.md.
describe("cable signal typing", () => {
  const sig = (edges: { source: string; target: string; signal?: string }[]) =>
    Object.fromEntries(
      edges.map((e) => [`${e.source}->${e.target}`, e.signal]),
    );

  it("turns midi into audio across an instrument", () => {
    const { edges } = buildGraph({
      ...graph(
        {
          lead: {
            from: "melody",
            // instruments emit audio; audio FX pass audio along.
            use: [
              { module: "synth", emits: "audio" },
              { module: "reverb", emits: "audio" },
            ],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["melody"],
      ),
      trackSignals: { melody: "midi" },
    });
    expect(sig(edges)).toEqual({
      "trk:melody->mod:synth": "midi", // the sequences track feeds MIDI in…
      "mod:synth->mod:reverb": "audio", // …and the instrument hands back audio
      "mod:reverb->snk:OUT": "audio",
    });
  });

  it("draws a split lane's two cables from their own jacks", () => {
    // A lane is not typed by what it carries: a run that named an output says so as `fromPort`.
    const { edges } = buildGraph({
      ...graph(
        {
          "gtr#audio": {
            from: "gtr",
            fromPort: "audio",
            use: [{ module: "amp", emits: "audio" }],
            out: [{ to: "OUT", gain: 1 }],
          },
          "gtr#midi": {
            from: "gtr",
            fromPort: "midi",
            use: [{ module: "synth", emits: "audio" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["gtr"],
      ),
      trackSignals: { gtr: "audio" },
    });
    expect(sig(edges)).toMatchObject({
      "trk:gtr->mod:amp": "audio",
      "trk:gtr->mod:synth": "midi",
    });
    const jacks = Object.fromEntries(
      edges
        .filter((e) => e.source === "trk:gtr")
        .map((e) => [e.target, e.sourcePort]),
    );
    expect(jacks).toEqual({ "mod:amp": "audio", "mod:synth": "midi" });
  });

  it("keeps a midi transformer's output midi", () => {
    // An arpeggiator takes midi and emits midi, so the run before the instrument stays blue.
    const { edges } = buildGraph({
      ...graph(
        {
          lead: {
            from: "keys",
            use: [
              { module: "arp", emits: "midi" },
              { module: "synth", emits: "audio" },
            ],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["keys"],
      ),
      trackSignals: { keys: "midi" },
    });
    expect(sig(edges)).toEqual({
      "trk:keys->mod:arp": "midi",
      "mod:arp->mod:synth": "midi",
      "mod:synth->snk:OUT": "audio",
    });
  });

  it("carries video through a video chain", () => {
    const { edges } = buildGraph({
      ...graph(
        {
          pic: {
            from: "cam",
            use: [{ module: "blur", emits: "video" }],
            out: [{ to: "VIDEO_OUT", gain: 1 }],
          },
        },
        ["cam"],
      ),
      trackSignals: { cam: "video" as never },
    });
    expect(sig(edges)["mod:blur->snk:VIDEO_OUT"]).toBe("video");
  });

  it("types a chain->chain send from the upstream chain's last module", () => {
    const { edges } = buildGraph(
      graph({
        lead: {
          from: "vox",
          use: [{ module: "comp", emits: "audio" }],
          out: [{ to: "reverb", gain: 0.3 }],
        },
        reverb: {
          use: [{ module: "conv", emits: "audio" }],
          out: [{ to: "OUT", gain: 1 }],
        },
      }),
    );
    expect(sig(edges)["mod:comp->mod:conv"]).toBe("audio");
  });

  it("leaves an untyped source's cable untyped rather than guessing", () => {
    const { edges } = buildGraph(
      graph({ a: { use: [{ module: "x" }], out: [{ to: "OUT", gain: 1 }] } }),
    );
    expect(sig(edges)["mod:x->snk:OUT"]).toBeUndefined();
  });
});

describe("cable signal through a pass-through chain", () => {
  it("carries the source's signal across a chain with no modules", () => {
    // An empty chain is a wire, not a processor — it emits whatever reached it.
    const { edges } = buildGraph({
      ...graph(
        { sc: { from: "keys", use: [], out: [{ to: "OUT", gain: 1 }] } },
        ["keys"],
      ),
      trackSignals: { keys: "midi" },
    });
    const out = edges.find((e) => e.target === "snk:OUT");
    expect(out?.signal).toBe("midi");
  });

  it("doesn't hang on a chain cycle while following a pass-through", () => {
    const { edges } = buildGraph(
      graph({
        a: { from: "b", use: [], out: [{ to: "OUT", gain: 1 }] },
        b: { from: "a", use: [], out: [{ to: "OUT", gain: 1 }] },
      }),
    );
    expect(edges.every((e) => e.signal === undefined)).toBe(true);
  });
});

// A STALE `from` must not collapse to a self-loop and take the track node with it. docs/graphBuild.md.
describe("a chain whose source track no longer exists", () => {
  it("still draws the track node instead of vanishing", () => {
    const { nodes, edges } = buildGraph(
      // `tracks` is empty: chains.yaml still says "vox", but tracks/ has moved on.
      graph(
        {
          vox: {
            from: "vox",
            use: [{ module: "eq" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        [],
      ),
    );
    expect(nodes.map((n) => n.id)).toContain("trk:vox");
    expect(edges.map((e) => `${e.source}->${e.target}`)).toContain(
      "trk:vox->mod:eq",
    );
  });

  it("keeps reading a REAL chain-to-chain feed as one", () => {
    // The guard must not break its own case: `from` naming another chain is still a chain link.
    const { nodes, edges } = buildGraph(
      graph(
        {
          send: {
            from: "lead",
            use: [{ module: "verb" }],
            out: [{ to: "OUT", gain: 1 }],
          },
          lead: {
            from: "vox",
            use: [{ module: "eq" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["vox"],
      ),
    );
    expect(nodes.map((n) => n.id)).not.toContain("trk:lead");
    expect(edges.map((e) => `${e.source}->${e.target}`)).toContain(
      "mod:eq->mod:verb",
    );
  });

  it("still resolves a track that shares its chain's name to the TRACK", () => {
    const { nodes } = buildGraph(
      graph(
        {
          drums: {
            from: "drums",
            use: [{ module: "comp" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["drums"],
      ),
    );
    expect(nodes.map((n) => n.id)).toContain("trk:drums");
  });
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
    // The TRACK and not a module: a source takes no input, so it is the one thing free to go up
    // there. A module pinned above what feeds it is pushed back down — see the describe below.
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

describe("headerFontPx", () => {
  // A card is only as wide as its grid, so the header's size is fitted. See docs/graphBuild.md.
  it("leaves a short name at the ceiling — this shrinks, it does not enlarge", () => {
    expect(headerFontPx("eq", 200)).toBe(HEADER_MAX_PX);
  });

  it("shrinks a long name until it fits, rather than cutting it", () => {
    const wide = headerFontPx("vo_jo-mixer", 200);
    const narrow = headerFontPx("vo_jo-mixer", 60);
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeGreaterThanOrEqual(HEADER_MIN_PX);
  });

  it("is monotonic in the NAME too: a longer one never gets a bigger size", () => {
    const sizes = ["a", "abcd", "abcdefgh", "abcdefghijklmnop"].map((n) =>
      headerFontPx(n, 84),
    );
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
  });

  it("floors rather than vanishing — a smudge is worse than an ellipsis", () => {
    expect(headerFontPx("a-very-long-module-name-indeed", 20)).toBe(
      HEADER_MIN_PX,
    );
  });

  it("survives an empty label without dividing by zero", () => {
    expect(Number.isFinite(headerFontPx("", 84))).toBe(true);
  });
});

describe("moduleDisplayName", () => {
  // The header wears the LAST segment: a card is one word wide, and the prefix is the useless half.
  it("keeps the last segment of a namespaced reference", () => {
    expect(moduleDisplayName("@st0/audio/dynamics/comp-opto")).toBe(
      "comp-opto",
    );
  });

  it("leaves a bare name alone", () => {
    expect(moduleDisplayName("gain")).toBe("gain");
  });

  it("falls back to the whole reference rather than showing nothing", () => {
    expect(moduleDisplayName("@st0/audio/")).toBe("@st0/audio/");
    expect(moduleDisplayName("")).toBe("");
  });
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

describe("a RACK node draws its sounds", () => {
  const kit = [
    { symbol: "BD", note: 36, clip: "kick" },
    { symbol: "HH", note: 42, clip: "hat" },
    { symbol: "SN", note: 38, clip: "snare" },
  ];

  it("gives one TAP per sound, named by symbol and bound to it, and a last tap that adds one", () => {
    const ui = rackUI(kit);
    expect(Object.keys(ui.widgets)).toEqual([
      "rack:BD",
      "rack:HH",
      "rack:SN",
      "rack+",
    ]);
    expect(ui.widgets["rack:BD"]).toMatchObject({
      type: "tap",
      label: "BD",
      bind: "@rack:BD",
      col: 0,
      row: 0,
      colSpan: TAP_COLS,
      rowSpan: TAP_ROWS,
    });
    expect(ui.widgets["rack+"]).toMatchObject({
      type: "tap",
      bind: RACK_ADD_BIND,
    });
    // Three taps to a row: the fourth — the add tap — starts the second.
    expect(ui.cols).toBe(3 * TAP_COLS);
    expect(ui.widgets["rack+"]).toMatchObject({ col: 0, row: TAP_ROWS });
  });

  it("draws only the add tap for a rack with no sound yet — how a kit node starts", () => {
    const ui = rackUI([]);
    expect(Object.keys(ui.widgets)).toEqual(["rack+"]);
    expect(ui.cols).toBe(TAP_COLS);
    expect(ui.rows).toBe(TAP_ROWS);
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

  it("lays the taps out three to a row, in the order it is handed", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      symbol: `P${i}`,
      note: 36 + i,
    }));
    const ui = rackUI(many);
    // Nine taps and the add tap: four rows of three.
    expect(ui.cols).toBe(3 * TAP_COLS);
    expect(ui.rows).toBe(4 * TAP_ROWS);
    expect(ui.widgets["rack:P4"]).toMatchObject({
      col: TAP_COLS,
      row: TAP_ROWS,
    });
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
    expect(Object.keys(node?.ui?.widgets ?? {})).toContain("rack:BD");
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

// A node that RECEIVES cannot sit above, or level with, what feeds it — a cable never climbs.
// dagre already guarantees it; a PIN does not, and a pin outranks dagre. See docs/graphBuild.md.
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

// The MASTER RUN — the sum and everything downstream — stands fully to the right of the rest.
// It is a PREFERENCE and not a correctness rule, so unlike `pushBelowInputs` a pin outranks it.
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

  it("sits BELOW every lane, not on the track row it is ranked with", () => {
    const { nodes, edges } = buildGraph(twoTracks);
    const laid = layout(nodes, edges);
    const run = runOf(laid);
    const sum = laid.nodes.find((n) => n.kind === "sink" && n.label === "MIX");
    // The sum is RANKED where a source is — the master run leaves it downward — and that used to
    // leave it on the track row with `OUT` at the bottom, one cable spanning the whole page.
    const deepest = Math.max(
      ...laid.nodes.filter((n) => !run.has(n.id)).map((n) => n.y + n.h),
    );
    expect(sum?.y).toBeGreaterThanOrEqual(deepest);
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
    // The limiter travels with the sum it processes, on both axes — that is the whole point of
    // taking the RUN rather than the two cards: a master chain may carry modules.
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
