import { describe, expect, it } from "vitest";
import { buildGraph, layout } from "./graph";
import {
  moduleCategoryOf,
  modulePreviewGraph,
  PREVIEW_CHAIN,
  PREVIEW_MIDI_SOURCE,
  PREVIEW_SOURCE,
  visibleGrid,
} from "./modulePreview";

const ui = (over: Record<string, unknown> = {}) => ({
  cols: 2,
  rows: 1,
  widgets: {
    drive: { type: "knob" as const, col: 0, row: 0, bind: "drive" },
  },
  ...over,
});

describe("one module as a graph", () => {
  it("hangs the module off a source and routes it out", () => {
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {});
    expect(g.tracks).toEqual([PREVIEW_SOURCE]);
    expect(g.chains[PREVIEW_CHAIN].from).toBe(PREVIEW_SOURCE);
    expect(g.chains[PREVIEW_CHAIN].out).toEqual([{ to: "OUT", gain: 1 }]);
  });

  it("feeds a module that takes notes from a MIDI source, with a MIDI cable", () => {
    const synth = modulePreviewGraph(
      "jun",
      "modules/instruments/synth/jun",
      ui(),
      {},
    );
    expect(synth.tracks).toEqual([PREVIEW_MIDI_SOURCE]);
    expect(synth.trackSignals).toEqual({ [PREVIEW_MIDI_SOURCE]: "midi" });
    expect(synth.chains[PREVIEW_CHAIN].use[0].emits).toBe("audio");
    const arp = modulePreviewGraph("arp", "modules/transformers/arp", ui(), {});
    expect(arp.chains[PREVIEW_CHAIN].from).toBe(PREVIEW_MIDI_SOURCE);
    expect(arp.chains[PREVIEW_CHAIN].use[0].emits).toBe("midi");
    const signals = buildGraph(synth).edges.map((e) => [e.source, e.signal]);
    expect(signals).toEqual([
      [`trk:${PREVIEW_MIDI_SOURCE}`, "midi"],
      ["mod:jun", "audio"],
    ]);
  });

  it("gives the node an engine address rather than leaving it decorative", () => {
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {});
    expect(g.chains[PREVIEW_CHAIN].use[0].pluginId).toBe(
      `${PREVIEW_CHAIN}:fuzz`,
    );
  });

  it("carries the grid and the values the file sets", () => {
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {
      drive: 0.7,
    });
    expect(g.chains[PREVIEW_CHAIN].use[0].ui?.cols).toBe(2);
    expect(g.chains[PREVIEW_CHAIN].use[0].params).toEqual({ drive: 0.7 });
  });

  it("carries the module's bases, and says nothing when it has none", () => {
    // The absence is read as "no base control here", so an empty folder must not arrive as [].
    const none = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {}, []);
    expect(none.chains[PREVIEW_CHAIN].use[0].bases).toBeUndefined();
    const some = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {}, [
      "warm",
    ]);
    expect(some.chains[PREVIEW_CHAIN].use[0].bases).toEqual(["warm"]);
  });
});

describe("the base dropdown, which the panel cannot fill in itself", () => {
  const withBaseWidget = (bases?: readonly string[]) =>
    buildGraph(
      modulePreviewGraph(
        "fuzz",
        "modules/audio/fuzz",
        {
          cols: 2,
          rows: 1,
          widgets: {
            b: { type: "dropdown" as const, col: 0, row: 0, bind: "@base" },
          },
        },
        {},
        bases,
      ),
    ).nodes.find((n) => n.kind === "module");

  it("lists the module's bases, with `none` first so a choice can be undone", () => {
    // The author wrote `bind: @base` and nothing else; the entries are the FOLDER's, via the step.
    const w = withBaseWidget(["warm", "bright"])?.ui?.widgets.b;
    expect(w?.options?.map((o) => o.label)).toEqual(["none", "warm", "bright"]);
  });

  it("still draws `none` alone when nothing was passed", () => {
    // The honest answer: a module with no bases has one entry, not none.
    const w = withBaseWidget()?.ui?.widgets.b;
    expect(w?.options?.map((o) => o.label)).toEqual(["none"]);
  });
});

describe("the grid the card draws", () => {
  it("drops hidden widgets", () => {
    // `hidden` is resolved by the compiler's merge, and there is no merge on this path.
    const grid = visibleGrid(
      ui({
        widgets: {
          drive: { type: "knob", col: 0, row: 0, bind: "drive" },
          secret: { type: "knob", col: 1, row: 0, bind: "x", hidden: true },
        },
      }),
    );
    expect(Object.keys(grid.widgets)).toEqual(["drive"]);
  });

  it("keeps the grid's own size, not the visible widgets' extent", () => {
    // The card is sized from cols × rows, so a hidden widget must not shrink it.
    const grid = visibleGrid(ui({ cols: 4, rows: 3, widgets: {} }));
    expect([grid.cols, grid.rows]).toEqual([4, 3]);
  });
});

// The four path shapes the two hosts hand over, for which no fixed index is right. docs/graphBuild.md.
describe("reading a module's type folder", () => {
  it("takes the segment after modules/", () => {
    expect(moduleCategoryOf("modules/instruments/synth")).toBe("instruments");
    expect(moduleCategoryOf("modules/audio/reverb/module.yaml")).toBe("audio");
  });

  it("reads a shared library, one folder deeper", () => {
    expect(
      moduleCategoryOf("_modules/audio/delay/tape-delay/module.yaml"),
    ).toBe("audio");
  });

  it("reads one behind a project prefix, with backslashes", () => {
    // What k7' file tree hands over on Windows in a multi-project workspace.
    expect(
      moduleCategoryOf(
        "LEMO - DANSE\\modules\\instruments\\drum_1\\module.yaml",
      ),
    ).toBe("instruments");
  });

  it("falls back rather than inventing a category the graph cannot draw", () => {
    expect(moduleCategoryOf("modules/whatever/thing")).toBe("audio");
    expect(moduleCategoryOf("nonsense")).toBe("audio");
    expect(moduleCategoryOf("")).toBe("audio");
  });
});

describe("through the shared pipeline", () => {
  it("lays out with real geometry", () => {
    const { nodes, edges } = buildGraph(
      modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {}),
    );
    const laid = layout(nodes, edges);
    expect(laid.nodes.length).toBeGreaterThan(0);
    for (const n of laid.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("draws the source, the module and the sink", () => {
    const { nodes } = buildGraph(
      modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {}),
    );
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toContain("track");
    expect(kinds).toContain("module");
    expect(kinds).toContain("sink");
  });

  it("sizes the card from the grid rather than the default", () => {
    // The card is NOT the grid: a panel that reads fine to edit can be another shape as a card.
    const card = (cols: number, rows: number) =>
      buildGraph(
        modulePreviewGraph(
          "fuzz",
          "modules/audio/fuzz",
          ui({ cols, rows }),
          {},
        ),
      ).nodes.find((n) => n.kind === "module");
    expect(card(8, 4)?.w).toBeGreaterThan(card(1, 1)?.w ?? 0);
  });
});
