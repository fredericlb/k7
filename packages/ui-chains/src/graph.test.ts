import type { WebGraph, WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  CELL,
  layout,
  moduleRow,
  NODE_H,
  NODE_MIN_W,
  NODE_W,
  nodeSize,
  subgraphForTrack,
  UI_PAD,
  widgetDenorm,
  widgetNorm,
  widgetRange,
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
  // An empty layout is what every page load starts with, for the moment before the
  // project arrives. dagre maxes over an empty node set and reports -Infinity, which is
  // TRUTHY — so the view's `if (!graph.width) return` guard passed, it framed a camera
  // to an infinite extent (translation = Infinity), reported success, and then never
  // framed the real graph because it believed it already had. The symptom was a graph
  // view that only failed to zoom-to-fit on a fresh open/refresh.
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
    // A curve node per binding, purple (kind "curve"), labelled by curve id + shape.
    expect(byId["aut:lead:0:Filter Freq"]).toMatchObject({
      kind: "curve",
      label: "sweep",
      sub: "custom",
    });
    expect(byId["aut:lead:0:Osc1 Tune"]).toMatchObject({
      kind: "curve",
      label: "wobble",
      sub: "lfo triangle",
    });
    // The widget-bound automation carries a node-local widget offset; the other doesn't.
    const withWidget = edges.find((e) => e.source === "aut:lead:0:Filter Freq");
    const noWidget = edges.find((e) => e.source === "aut:lead:0:Osc1 Tune");
    expect(withWidget?.target).toBe("mod:synth");
    expect(withWidget?.automation).toMatchObject({ param: "Filter Freq" });
    expect(withWidget?.automation?.widget).toBeTruthy();
    expect(noWidget?.automation).toMatchObject({ param: "Osc1 Tune" });
    expect(noWidget?.automation?.widget).toBeUndefined();
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
    // `from` names a track that ALSO happens to be a chain name (a common authoring
    // pattern: one chain per track, same name). It must resolve to the TRACK, not be
    // mistaken for a chain-feeds-chain self-loop and dropped — otherwise the track
    // node vanishes and cable-wobble liveness has nothing to seed from.
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

  // A splitter feeds one target from two of its outputs. Keyed on the PAIR alone, the second
  // collapsed into the first and the graph drew one cable — out of the wrong jack, since the
  // survivor kept the first port it saw. The pair is not the identity of a cable; the socket is.
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

  // …and the other half of the same key: one link expressed from BOTH ends is still one cable,
  // whichever end is visited first. Only one of the two carries the port.
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

describe("nodeSize", () => {
  it("is the plain size with no UI, and grows to fit a UI grid", () => {
    expect(nodeSize(undefined)).toEqual({ w: NODE_W, h: NODE_H });
    expect(nodeSize({ cols: 4, rows: 3, widgets: {} }).h).toBeGreaterThan(
      NODE_H,
    );
  });

  it("is its GRID's width, not the no-panel minimum", () => {
    // A panelled node used to inherit NODE_W as a floor, which parked dead space to the right of every grid
    // narrower than 160px — a 2-column mixer strip is 84px of controls in a 160px card.
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBe(
      UI_PAD * 2 + 2 * CELL,
    );
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBeLessThan(NODE_W);
  });

  it("still leaves the header something to be drawn in", () => {
    // The one case the grid alone cannot answer: a single column is 48px, and the header's padding and kind glyph
    // eat that before a single character of the name.
    expect(nodeSize({ cols: 1, rows: 2, widgets: {} }).w).toBe(NODE_MIN_W);
  });
});

// A cable is coloured by WHAT IT CARRIES, so the signal path reads at a glance. The
// type comes from the edge's SOURCE — a track's contentType, or the module's type
// folder — because an instrument takes midi and gives back audio: the wire into it is
// blue and the one out of it orange.
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

  it("keeps a midi transformer's output midi", () => {
    // The other midi-input module: an arpeggiator takes midi and emits midi, so the
    // whole run before the instrument stays blue.
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
    // An empty chain is a wire, not a processor — it emits what reached it. Without
    // this its outgoing cable was the only untyped one in a real song.
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

// A chain takes its name from its source track when it isn't named explicitly, so
// `from` and the chain's own name are usually the same string. That made a STALE `from`
// — a track renamed without chains.yaml catching up — resolve to the chain itself, which
// collapsed to a self-loop and took the whole track node out of the drawing. A broken
// reference has to be visible, not invisible.
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
    // The guard must not break the case it was written for: `from` naming another
    // chain is still a chain link, not a track.
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
  it("draws a track no chain mentions, marked and unwired", () => {
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
    expect(spare?.sub).toBe("no chain");
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

// Video lanes are chain sources like any other, and — like audio tracks — one that no
// chain mentions is still drawn: it still DRAWS (project.layers composites it), so
// leaving it out would understate the song. Only its glyph and its strip differ.
describe("video tracks", () => {
  const withVideo = (
    chains: WebGraph["chains"],
    tracks: string[],
    videoTracks: string[],
  ): WebGraph => ({ chains, tracks, videoTracks, warnings: [] });

  it("draws an unrouted video lane as an orphan, exactly as an audio one", () => {
    const { nodes } = buildGraph(withVideo({}, ["spare"], ["main"]));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Same kind, same "no chain" note — the two read alike because they mean alike.
    expect(byId["trk:spare"]).toMatchObject({ kind: "track", sub: "no chain" });
    expect(byId["trk:main"]).toMatchObject({
      kind: "track",
      sub: "no chain",
      video: true,
    });
  });

  it("gives a video lane a mute-only strip, not the mixer's five controls", () => {
    const { nodes } = buildGraph(withVideo({}, ["spare"], ["main"]));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Picture has no solo, no record arm, no gain and no pan to offer.
    expect(Object.keys(byId["trk:main"].ui?.widgets ?? {})).toEqual(["mute"]);
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
    // Routed, so no "no chain" note — but still marked video.
    expect(byId["trk:main"]).toMatchObject({ kind: "track", video: true });
    expect(byId["trk:main"].sub).toBeUndefined();
    const cable = edges.find((e) => e.source === "trk:main");
    expect(cable?.signal).toBe("video"); // not the audio default
  });
});

// A live input is the node its run STARTS at, and what it feeds is a TRACK. The arrow has
// to land on the track node: a track-fed chain is called after its track, so `isChain`
// says yes to the same name and the edge used to be drawn to that chain's first MODULE —
// past the point where the signal actually arrives.
describe("an input wired to a track", () => {
  it("draws the arrow to the track, not to its first module", () => {
    const { edges } = buildGraph({
      chains: {
        // The input's own run: one node, landing on the track.
        "IN:in-2": {
          use: [{ module: "IN:in-2" }],
          out: [{ to: "gtr", gain: 1 }],
        },
        // …and the track's own lane, whose first module is where the arrow used to go.
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

describe("moduleRow", () => {
  // The Mixer panel: named modules laid out side by side, in the order the caller gives — the
  // song's track order. dagre is not used, because there is nothing here to route and the order
  // is not a layout engine's to choose.
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
    // Same id, same size, same chain: only the position is the row's. That is what lets a strip
    // carry its live values, its VU and its own menu without any of it re-implemented here.
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
    // The full graph gives this same card its jacks — a cable arrives and one leaves. Here there
    // are no cables at all, so drawing the plates would only put furniture between the strips.
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
    // The list comes from the compiled project and the graph is fetched separately, so the two
    // can be one reload apart.
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
    // Elbow room, not bigger controls: the grid inside is a fixed cell size (widgetRect), so the
    // height must not move or the card would gain dead space below the controls too.
    const plain = moduleRow(one, ["mx-vox"]).nodes[0];
    const wide = moduleRow(one, ["mx-vox"], 1.5).nodes[0];
    expect(wide.w).toBe(Math.round(plain.w * 1.5));
    expect(wide.h).toBe(plain.h);
  });

  it("spaces the row by the WIDENED width, so cards still cannot overlap", () => {
    const row = moduleRow(one, ["mx-vox", "mx-bass"], 1.5);
    const [first, second] = row.nodes;
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w);
    expect(row.width).toBeGreaterThan(second.x + second.w - 1);
  });

  it("defaults to the card's own width", () => {
    expect(moduleRow(one, ["mx-vox"]).nodes[0].w).toBe(
      moduleRow(one, ["mx-vox"], 1).nodes[0].w,
    );
  });
});
