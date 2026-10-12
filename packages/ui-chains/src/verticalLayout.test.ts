// The VERTICAL layout: a panel's narrow twin drawn in its place, its tabs a menu across the top
// rather than a column — and a panel with no twin still drawn as a menu, folded by the view.

import type { WebGraph, WebModuleUI } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  columnW,
  layout,
  menuH,
  nodeSize,
  rowsHeight,
  TAB_COL_W,
  TAB_H,
  TAB_MENU_H,
  withOpenTabs,
} from "./graph";

const knob = (col: number, row: number, bind: string) => ({
  type: "knob" as const,
  col,
  row,
  colSpan: 2,
  rowSpan: 2,
  bind,
});
const ui: WebModuleUI = {
  cols: 8,
  rows: 2,
  widgets: {},
  tabs: [
    { name: "OSC", widgets: { a: knob(0, 0, "A"), b: knob(2, 0, "B") } },
    { name: "FLT", widgets: { c: knob(0, 0, "C") } },
  ],
  vertical: {
    cols: 4,
    rows: 2,
    widgets: {},
    tabs: [
      { name: "OSC", widgets: { a: knob(0, 0, "A"), b: knob(2, 0, "B") } },
      { name: "FLT", widgets: { c: knob(0, 0, "C") } },
    ],
  },
};
const graph: WebGraph = {
  chains: {
    c: { use: [{ module: "synth", ui }], out: [{ to: "MIX", gain: 1 }] },
  },
  tracks: [],
  warnings: [],
};
const synth = (layout?: "horizontal" | "vertical") =>
  buildGraph(graph, { layout }).nodes.find((n) => n.module === "synth");

describe("the vertical layout", () => {
  it("draws the panel's narrow twin, its tabs a menu: no column, one line on top", () => {
    const n = synth("vertical");
    expect(n?.ui?.cols).toBe(4);
    expect(n?.ui?.tabsAs).toBe("dropdown");
    expect(columnW(n?.ui)).toBe(0);
    expect(menuH(n?.ui)).toBe(TAB_MENU_H);
    expect(n?.w).toBeLessThan(synth()?.w ?? 0);
  });

  it("leaves the horizontal panel as it is: its own grid, its tabs a column", () => {
    const n = synth();
    expect(n?.ui?.cols).toBe(8);
    expect(columnW(n?.ui)).toBe(TAB_COL_W);
    expect(menuH(n?.ui)).toBe(0);
  });

  it("draws a panel with no twin as itself, tabs as a menu, for the view to fold", () => {
    const { vertical: _v, ...bare } = ui;
    const g: WebGraph = {
      ...graph,
      chains: {
        c: {
          use: [{ module: "synth", ui: bare }],
          out: [{ to: "MIX", gain: 1 }],
        },
      },
    };
    const n = buildGraph(g, { layout: "vertical" }).nodes.find(
      (x) => x.module === "synth",
    );
    expect(n?.ui?.cols).toBe(8);
    expect(n?.ui?.tabsAs).toBe("dropdown");
    expect(nodeSize(n?.ui).h).toBeGreaterThan(nodeSize(bare).h - TAB_MENU_H);
  });

  it("keeps a horizontal card's tabs a column, however many, and the card no taller than 4 rows", () => {
    const many: WebModuleUI = {
      cols: 8,
      rows: 4,
      widgets: {},
      tabs: Array.from({ length: 25 }, (_, i) => ({
        name: `T${i}`,
        widgets: {},
      })),
    };
    expect(columnW(many)).toBe(TAB_COL_W);
    expect(menuH(many)).toBe(0);
    expect(nodeSize(many).h).toBe(nodeSize({ ...many, tabs: undefined }).h);
    // A short panel still grows to list a few tabs, up to 4 rows' height.
    const short: WebModuleUI = {
      ...many,
      rows: 1,
      tabs: many.tabs?.slice(0, 5),
    };
    expect(nodeSize(short).h - nodeSize({ ...short, tabs: undefined }).h).toBe(
      5 * TAB_H - rowsHeight(1),
    );
  });

  it("draws a narrow card as tall as its OPEN page, its top edge where it was", () => {
    const tall: WebModuleUI = {
      ...ui,
      vertical: {
        cols: 4,
        rows: 6,
        widgets: {},
        tabs: [
          {
            name: "OSC",
            widgets: {
              a: knob(0, 0, "A"),
              b: knob(0, 2, "B"),
              z: knob(0, 4, "Z"),
            },
          },
          { name: "FLT", widgets: { c: knob(0, 0, "C") } },
        ],
      },
    };
    const g: WebGraph = {
      ...graph,
      chains: {
        c: {
          use: [{ module: "synth", ui: tall }],
          out: [{ to: "MIX", gain: 1 }],
        },
      },
    };
    const built = buildGraph(g, { layout: "vertical" });
    const { nodes } = layout(built.nodes, built.edges);
    const n = nodes.find((x) => x.module === "synth");
    expect(n?.tabH?.[0]).toBe(n?.h);
    expect(n?.tabH?.[1]).toBe((n?.h ?? 0) - rowsHeight(6) + rowsHeight(2));
    const shown = withOpenTabs(nodes, { [n?.id ?? ""]: 1 }).find(
      (x) => x.id === n?.id,
    );
    expect(shown?.h).toBe(n?.tabH?.[1]);
    expect(shown?.y).toBe(n?.y);
    // Nothing open past the first page: the same nodes, not a copy.
    expect(withOpenTabs(nodes, {})).toBe(nodes);
  });
});
