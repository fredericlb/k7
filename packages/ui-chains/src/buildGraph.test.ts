// buildGraph.test.ts — the graph built from a document: the cards, the cables between them, their
// signals and the curves bound to them.

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

  it("wires the node's note-on into a curve an event condition starts, and none into one that runs always", () => {
    const lfo = {
      type: "lfo" as const,
      polarity: "unipolar" as const,
      amplitude: 1,
      shape: "saw" as const,
      frequency: 1,
      phase: 0,
    };
    const { nodes, edges } = buildGraph({
      chains: {
        lead: {
          use: [
            {
              module: "synth",
              automations: [
                { param: "Cut", curve: "onNote" },
                { param: "Res", curve: "free" },
              ],
            },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: [],
      curves: {
        onNote: {
          type: "lfo",
          spec: {
            ...lfo,
            conditions: [{ type: "event", event: "note-on", retrigger: true }],
          },
        },
        free: { type: "lfo", spec: lfo },
      },
      warnings: [],
    });
    const fired = edges.filter((e) => e.signal === "event");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      source: "mod:synth",
      target: "crv:onNote@synth:Cut",
      sourcePort: "note-on",
    });
    const card = (id: string) => nodes.find((n) => n.id === id);
    expect(card("crv:onNote@synth:Cut")?.eventIn).toBe(true);
    expect(card("crv:free@synth:Res")?.eventIn).toBe(false);
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
