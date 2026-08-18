// A tabs widget's pages are real widget maps, and the grid edits ONE of them at a time. What is
// pinned here is the write path: the panel and every page other than the one being edited must
// come back untouched, because nothing on screen would show them going missing until the file is
// saved and a page nobody was looking at has gone.

import type { ModuleUI, Widget } from "@studio/song/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { type PageRef, widgetsAt, writeWidgetsAt } from "./WidgetGridEditor";

const knob = (col: number): Widget => ({ type: "knob", col, row: 0 });

/** A panel with one plain widget and a tabs widget of two pages, one of them filled. */
const ui = (): ModuleUI => ({
  cols: 8,
  rows: 4,
  widgets: {
    amp: knob(0),
    t1: {
      type: "tabs",
      col: 0,
      row: 1,
      pages: {
        General: { g1: knob(1) },
        Filtre: {},
      },
    },
  },
});

describe("which map the grid is on", () => {
  it("the panel's own widgets when it is on no page", () => {
    expect(Object.keys(widgetsAt(ui(), null))).toEqual(["amp", "t1"]);
  });

  it("a page's widgets when it is on one", () => {
    expect(
      Object.keys(widgetsAt(ui(), { tabs: "t1", name: "General" })),
    ).toEqual(["g1"]);
  });

  it("an EMPTY map for a page with nothing on it", () => {
    expect(widgetsAt(ui(), { tabs: "t1", name: "Filtre" })).toEqual({});
  });

  it("…and an empty map for a page that is not there AT ALL — never the panel's", () => {
    // This is what the `?? {}` is for, and the case the one above does not reach: `Filtre`
    // exists and answers `{}` on its own. Falling back to the panel here would draw its
    // widgets as if they were the page's, and the first edit would move somebody else's.
    const stale: PageRef = { tabs: "t1", name: "renamed away" };
    expect(widgetsAt(ui(), stale)).toEqual({});
    expect(widgetsAt(ui(), { tabs: "gone", name: "General" })).toEqual({});
  });
});

describe("writing a map back", () => {
  it("replaces the panel's widgets when on no page", () => {
    const next = writeWidgetsAt(ui(), null, { only: knob(3) });
    expect(Object.keys(next.widgets)).toEqual(["only"]);
  });

  it("replaces ONE page and leaves its siblings alone", () => {
    const next = writeWidgetsAt(
      ui(),
      { tabs: "t1", name: "Filtre" },
      {
        cut: knob(2),
      },
    );
    const pages = next.widgets.t1.pages!;
    expect(Object.keys(pages)).toEqual(["General", "Filtre"]);
    expect(Object.keys(pages.General)).toEqual(["g1"]); // the other page survives
    expect(Object.keys(pages.Filtre)).toEqual(["cut"]);
  });

  it("leaves the panel and the tabs widget's own fields alone", () => {
    const next = writeWidgetsAt(ui(), { tabs: "t1", name: "General" }, {});
    expect(next.widgets.amp).toEqual(knob(0)); // the panel is not a page
    expect(next.widgets.t1.col).toBe(0);
    expect(next.widgets.t1.row).toBe(1);
    expect(next.cols).toBe(8);
  });

  it("mutates nothing — the caller's document is still what it was", () => {
    const before = ui();
    writeWidgetsAt(before, { tabs: "t1", name: "General" }, { x: knob(5) });
    expect(Object.keys(before.widgets.t1.pages!.General)).toEqual(["g1"]);
  });

  it("refuses a page whose tabs widget has gone, rather than inventing one", () => {
    // The grid guards this too, but a stale ref reaching here must not grow a widget map under
    // an id that is not in the panel — that would be a widget nothing draws and nobody can find.
    const before = ui();
    expect(writeWidgetsAt(before, { tabs: "gone", name: "x" }, {})).toBe(
      before,
    );
  });
});
