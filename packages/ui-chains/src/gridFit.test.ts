// gridFit.test.ts — a grid held to N rows folds its overflow into columns beside it (and N columns into rows
// below), never through a widget, and a grid that already fits comes back untouched.

import type { WebGraph, WebModuleUI, WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, FOOTER_H, moduleRow, nodeSize } from "./graph";
import { fitPanel, foldBands } from "./gridFit";

const knob = (
  col: number,
  row: number,
  extra: Partial<WebWidget> = {},
): WebWidget => ({
  type: "knob",
  col,
  row,
  ...extra,
});

/** A 2-wide grid, one knob per cell, `rows` tall. */
function column(rows: number): WebModuleUI {
  const widgets: Record<string, WebWidget> = {};
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 2; c++) widgets[`k${r}${c}`] = knob(c, r);
  return { cols: 2, rows, widgets };
}

describe("fitPanel, rows held", () => {
  it("leaves a grid that fits untouched", () => {
    const ui = column(6);
    expect(fitPanel(ui, { axis: "rows", max: 6 })).toBe(ui);
  });

  it("folds rows past the cap into a band of columns on the right", () => {
    const out = fitPanel(column(9), { axis: "rows", max: 6 });
    expect(out.rows).toBe(6);
    expect(out.cols).toBe(4);
    // Row 6, the first to overflow, lands at the top of the second band.
    expect(out.widgets.k60).toMatchObject({ col: 2, row: 0 });
    expect(out.widgets.k81).toMatchObject({ col: 3, row: 2 });
    // …and what fitted stays where it was.
    expect(out.widgets.k51).toMatchObject({ col: 1, row: 5 });
  });

  it("makes as many bands as the overflow needs", () => {
    const out = fitPanel(column(14), { axis: "rows", max: 6 });
    expect(out.cols).toBe(6);
    expect(out.widgets.k130).toMatchObject({ col: 4, row: 1 });
  });

  it("never cuts through a widget: it moves whole, the band ending before it", () => {
    const ui: WebModuleUI = {
      cols: 1,
      rows: 8,
      widgets: {
        a: knob(0, 0, { rowSpan: 5 }),
        tall: knob(0, 5, { rowSpan: 3 }),
      },
    };
    const out = fitPanel(ui, { axis: "rows", max: 6 });
    expect(out.widgets.tall).toMatchObject({ col: 1, row: 0, rowSpan: 3 });
    expect(out.rows).toBe(5);
  });

  it("folds the common widgets and every tab's with the same bands", () => {
    const ui: WebModuleUI = {
      cols: 1,
      rows: 8,
      widgets: { common: knob(0, 7) },
      tabs: [
        { name: "A", widgets: { a: knob(0, 6) } },
        { name: "B", widgets: { b: knob(0, 1) } },
      ],
    };
    const out = fitPanel(ui, { axis: "rows", max: 6 });
    expect(out.widgets.common).toMatchObject({ col: 1, row: 1 });
    expect(out.tabs?.[0].widgets.a).toMatchObject({ col: 1, row: 0 });
    expect(out.tabs?.[1].widgets.b).toMatchObject({ col: 0, row: 1 });
  });
});

describe("fitPanel, columns held", () => {
  it("folds columns past the cap into rows below", () => {
    const ui: WebModuleUI = {
      cols: 5,
      rows: 1,
      widgets: Object.fromEntries(
        [0, 1, 2, 3, 4].map((c) => [`c${c}`, knob(c, 0)]),
      ),
    };
    const out = fitPanel(ui, { axis: "cols", max: 3 });
    expect(out).toMatchObject({ cols: 3, rows: 2 });
    expect(out.widgets.c3).toMatchObject({ col: 0, row: 1 });
    expect(out.widgets.c4).toMatchObject({ col: 1, row: 1 });
  });
});

describe("foldBands", () => {
  it("runs a band long rather than split a widget taller than the cap", () => {
    expect(foldBands(9, 3, [{ at: 1, len: 5 }])).toEqual([
      [0, 1],
      [1, 6],
      [6, 9],
    ]);
  });
});

describe("buildGraph with a fit", () => {
  const g = (ui: WebModuleUI): WebGraph => ({
    chains: {
      lead: {
        from: "keys",
        use: [{ module: "big", ui }],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    tracks: ["keys"],
    warnings: [],
  });
  const card = (fit?: Parameters<typeof buildGraph>[1]) =>
    buildGraph(g(column(9)), fit).nodes.find((n) => n.module === "big");

  it("folds a card's panel and sizes the card to the folded grid", () => {
    const n = card({ fit: { axis: "rows", max: 6 } });
    expect(n?.ui).toMatchObject({ rows: 6, cols: 4 });
    const folded = nodeSize({ cols: 4, rows: 6, widgets: {} });
    expect(n?.w).toBe(folded.w);
    expect(n?.h).toBe(folded.h + FOOTER_H);
  });

  it("leaves every card as written without one", () => {
    expect(card()?.ui).toMatchObject({ rows: 9, cols: 2 });
  });
});

// Surge XT's shape: a header row, then tabs whose sections are FRAMED and whose screens run long.
describe("fitPanel, a tabbed panel", () => {
  const header = { vol: knob(0, 0) };
  const tab = (
    name: string,
    cut: number,
  ): NonNullable<WebModuleUI["tabs"]>[number] => ({
    name,
    widgets: {
      // A knob two rows tall sitting across `cut - 1 / cut` in no other tab: each tab cuts where IT can.
      [`${name}-a`]: knob(0, cut - 1, { rowSpan: 2 }),
      [`${name}-b`]: knob(1, 9),
    },
  });

  it("folds each tab on its own, so one tab's tall widget does not hold every other back", () => {
    const ui: WebModuleUI = {
      cols: 2,
      rows: 11,
      widgets: header,
      tabs: [tab("x", 3), tab("y", 6)],
    };
    const out = fitPanel(ui, { axis: "rows", max: 6 });
    expect(out.rows).toBeLessThanOrEqual(6);
    expect(out.widgets.vol).toMatchObject({ row: 0, col: 0 });
  });

  it("cuts a frame into one piece per band, the label on the first", () => {
    const ui: WebModuleUI = {
      cols: 2,
      rows: 10,
      widgets: {
        sec: {
          type: "group",
          col: 0,
          row: 0,
          colSpan: 2,
          rowSpan: 10,
          label: "OSC",
        },
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, r) => [`k${r}`, knob(0, r)]),
        ),
      },
    };
    const out = fitPanel(ui, { axis: "rows", max: 5 });
    expect(out.rows).toBe(5);
    expect(out.widgets.sec).toMatchObject({ row: 0, rowSpan: 5, label: "OSC" });
    // The knobs use one column, so the second band is one column wide, and the frame's second piece with it.
    expect(out.widgets["sec~1"]).toMatchObject({
      row: 0,
      rowSpan: 5,
      col: 1,
      colSpan: 1,
    });
    expect(out.cols).toBe(2);
    expect(out.widgets["sec~1"].label).toBeUndefined();
  });

  it("shortens a screen to its band rather than letting it hold the cut", () => {
    const ui: WebModuleUI = {
      cols: 3,
      rows: 9,
      widgets: {
        top: knob(0, 0),
        screen: { type: "lcdscreen", col: 1, row: 1, colSpan: 2, rowSpan: 8 },
        ...Object.fromEntries(
          Array.from({ length: 8 }, (_, r) => [`k${r}`, knob(0, r + 1)]),
        ),
      },
    };
    const out = fitPanel(ui, { axis: "rows", max: 6 });
    expect(out.rows).toBeLessThanOrEqual(6);
    expect(out.widgets.screen.row).toBe(1);
    expect(out.widgets.screen.rowSpan).toBe(5);
  });

  // The overflow is as wide as what it holds: two rows using two columns of a six-wide grid are a two-wide band.
  it("sizes each band to the columns its widgets use", () => {
    const widgets: Record<string, WebWidget> = {};
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 6; c++) widgets[`k${r}${c}`] = knob(c, r);
    widgets.x0 = knob(0, 5);
    widgets.x1 = knob(1, 6);
    const out = fitPanel(
      { cols: 6, rows: 7, widgets },
      { axis: "rows", max: 5 },
    );
    expect(out.rows).toBe(5);
    expect(out.cols).toBe(8);
    expect(out.widgets.x0).toMatchObject({ row: 0, col: 6 });
    expect(out.widgets.x1).toMatchObject({ row: 1, col: 7 });
  });
});

// A card sized to its OPEN tab: the fold records each tab's own width, the layout reads the one showing.
describe("a tab's own width", () => {
  const wide = (
    name: string,
    cols: number,
  ): NonNullable<WebModuleUI["tabs"]>[number] => ({
    name,
    widgets: Object.fromEntries(
      Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: cols }, (_, c) => [`${name}${r}${c}`, knob(c, r)]),
      ).flat(),
    ),
  });
  const ui: WebModuleUI = {
    cols: 6,
    rows: 8,
    widgets: {},
    tabs: [wide("narrow", 2), wide("broad", 6)],
  };

  it("records the columns each tab needs once folded", () => {
    const out = fitPanel(ui, { axis: "rows", max: 4 });
    expect(out.tabs?.map((t) => t.cols)).toEqual([4, 12]);
    expect(out.cols).toBe(12);
  });

  it("sizes the card to the open tab, and moves the next card with it", () => {
    const graph: WebGraph = {
      chains: {
        c: {
          use: [{ module: "synth", ui }, { module: "after" }],
          out: [{ to: "MIX", gain: 1 }],
        },
      },
      tracks: [],
      warnings: [],
    };
    const fit = { axis: "rows" as const, max: 4 };
    const at = (tab: number) => {
      const built = buildGraph(graph, { fit }).nodes.find(
        (n) => n.module === "synth",
      );
      const laid = moduleRow(graph, ["synth", "after"], {
        asDrawn: true,
        fit,
        tabOf: built ? { [built.id]: tab } : {},
      });
      const [synth, after] = laid.nodes;
      return { w: synth.w, next: after.x };
    };
    const narrow = at(0);
    const broad = at(1);
    expect(narrow.w).toBeLessThan(broad.w);
    expect(broad.next - narrow.next).toBe(broad.w - narrow.w);
  });
});
