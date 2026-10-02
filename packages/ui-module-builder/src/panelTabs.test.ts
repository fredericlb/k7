// A panel's tabs as the builder edits them. What is pinned: one tab writes no list, the second makes
// it from the panel's widgets, removing back to one folds it away, and a name is ten characters at
// most and never another tab's.

import { describe, expect, it } from "vitest";
import type { ModuleUI, Widget } from "./moduleUi";
import {
  addTab,
  moveTab,
  pageIn,
  panelIds,
  removeTab,
  renameTab,
  widgetsAt,
  writeWidgetsAt,
} from "./panelTabs";

const knob = (col: number): Widget => ({
  type: "knob",
  col,
  row: 0,
  bind: "Mix",
});
const plain = (): ModuleUI => ({ cols: 4, rows: 2, widgets: { a: knob(0) } });
const tabbed = (): ModuleUI => ({
  cols: 4,
  rows: 2,
  widgets: { s: knob(3) },
  tabs: [
    { name: "Osc", widgets: { o: knob(0) } },
    { name: "Filter", widgets: { f: knob(1) } },
  ],
});

describe("which map the grid writes", () => {
  it("is the first tab of a tabbed panel, and the panel itself otherwise", () => {
    expect(pageIn(tabbed(), undefined)).toBe(0);
    expect(pageIn(plain(), undefined)).toBeNull();
    // `null` chosen is the widgets every tab shows; a tab that has gone falls back to the first.
    expect(pageIn(tabbed(), null)).toBeNull();
    expect(pageIn(tabbed(), 7)).toBe(0);
  });

  it("reads and writes one tab, leaving the others alone", () => {
    const ui = tabbed();
    expect(Object.keys(widgetsAt(ui, 1))).toEqual(["f"]);
    const next = writeWidgetsAt(ui, 1, { g: knob(2) });
    expect(Object.keys(next.tabs?.[1].widgets ?? {})).toEqual(["g"]);
    expect(next.tabs?.[0]).toBe(ui.tabs?.[0]);
    expect(writeWidgetsAt(ui, null, {}).widgets).toEqual({});
  });

  it("counts every tab's ids, since an id names one widget across the panel", () => {
    expect([...panelIds(tabbed())].sort()).toEqual(["f", "o", "s"]);
  });
});

describe("adding and removing", () => {
  it("makes TWO tabs from a plain panel, its widgets becoming the first", () => {
    const { ui, at } = addTab(plain());
    expect(ui.tabs?.map((t) => t.name)).toEqual(["Main", "Tab 2"]);
    expect(Object.keys(ui.tabs?.[0].widgets ?? {})).toEqual(["a"]);
    expect(ui.widgets).toEqual({});
    expect(at).toBe(1);
  });

  it("adds at the end of a tabbed panel, under a name nobody has", () => {
    const { ui, at } = addTab(tabbed());
    expect(ui.tabs?.map((t) => t.name)).toEqual(["Osc", "Filter", "Tab 3"]);
    expect(at).toBe(2);
  });

  it("folds the list away when one tab is left, its widgets joining the panel's", () => {
    const ui = removeTab(tabbed(), 0);
    expect(ui.tabs).toBeUndefined();
    expect(Object.keys(ui.widgets).sort()).toEqual(["f", "s"]);
  });
});

describe("renaming and reordering", () => {
  it("cuts a name to ten characters, and refuses an empty one or another tab's", () => {
    expect(renameTab(tabbed(), 0, "  Oscillators  ").tabs?.[0].name).toBe(
      "Oscillator",
    );
    const ui = tabbed();
    expect(renameTab(ui, 0, "   ")).toBe(ui);
    expect(renameTab(ui, 0, "Filter")).toBe(ui);
  });

  it("moves a tab one place, and says where it went", () => {
    const { ui, at } = moveTab(tabbed(), 0, 1);
    expect(ui.tabs?.map((t) => t.name)).toEqual(["Filter", "Osc"]);
    expect(at).toBe(1);
    // …and not past either end.
    expect(moveTab(tabbed(), 0, -1).at).toBe(0);
  });
});
