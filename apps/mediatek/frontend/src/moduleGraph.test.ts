import { buildGraph, layout } from "@studio/ui-chains/graph";
import type { ModuleUI } from "@studio/ui-module-builder/module-ui";
import { describe, expect, it } from "vitest";
import { PREVIEW_CHAIN, previewPluginId } from "./engine/preview";
import {
  categoryOf,
  modulePreviewGraph,
  SOURCE,
  visibleGrid,
} from "./moduleGraph";

const ui = (over: Partial<ModuleUI> = {}): ModuleUI => ({
  cols: 2,
  rows: 1,
  widgets: { drive: { type: "knob", col: 0, row: 0, bind: "drive" } },
  ...over,
});

describe("the module as a WebGraph", () => {
  it("hangs the module off a source and routes it out", () => {
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {});
    expect(g.tracks).toEqual([SOURCE]);
    expect(g.chains[PREVIEW_CHAIN].from).toBe(SOURCE);
    expect(g.chains[PREVIEW_CHAIN].out).toEqual([{ to: "OUT", gain: 1 }]);
  });

  it("addresses the node where the engine actually loaded the plugin", () => {
    // The preview doc and the node must name the SAME plugin, or the picture is of a signal
    // path that does not exist.
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {});
    expect(g.chains[PREVIEW_CHAIN].use[0].pluginId).toBe(
      previewPluginId("fuzz"),
    );
  });

  it("carries the grid and the values the file sets", () => {
    const g = modulePreviewGraph("fuzz", "modules/audio/fuzz", ui(), {
      drive: 0.7,
    });
    expect(g.chains[PREVIEW_CHAIN].use[0].ui?.cols).toBe(2);
    expect(g.chains[PREVIEW_CHAIN].use[0].params).toEqual({ drive: 0.7 });
  });
});

describe("the grid the node draws", () => {
  it("drops hidden widgets", () => {
    // A WebModuleUI has `hidden` resolved away by the compiler's merge; there is no merge
    // here, so a hidden widget would otherwise appear on the node and nowhere else.
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
    // The card is sized from cols × rows. Shrinking it because a widget is hidden would make
    // the preview lie about how big the module is.
    const grid = visibleGrid(ui({ cols: 4, rows: 3, widgets: {} }));
    expect([grid.cols, grid.rows]).toEqual([4, 3]);
  });
});

describe("no compiler, no project folder", () => {
  it("lays out a browser-built graph through the shared pipeline", () => {
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
    // The reason the preview earns its 30%: the node is NOT the grid — a panel that reads
    // fine as an editing surface can come out a different shape as a card.
    const wide = buildGraph(
      modulePreviewGraph(
        "fuzz",
        "modules/audio/fuzz",
        ui({ cols: 8, rows: 4 }),
        {},
      ),
    );
    const narrow = buildGraph(
      modulePreviewGraph(
        "fuzz",
        "modules/audio/fuzz",
        ui({ cols: 1, rows: 1 }),
        {},
      ),
    );
    const nodeOf = (g: ReturnType<typeof buildGraph>) =>
      g.nodes.find((n) => n.kind === "module");
    expect(nodeOf(wide)?.w).toBeGreaterThan(nodeOf(narrow)?.w ?? 0);
  });
});

describe("reading a module's type folder", () => {
  it("takes the folder under modules/", () => {
    expect(categoryOf("modules/instruments/synth")).toBe("instruments");
    expect(categoryOf("modules/io/in")).toBe("io");
  });

  it("falls back rather than inventing a category the graph cannot draw", () => {
    expect(categoryOf("modules/whatever/thing")).toBe("audio");
    expect(categoryOf("nonsense")).toBe("audio");
  });
});
