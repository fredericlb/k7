import type { Widget } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { clipIds, copyWidgets, pasteWidgets } from "./widgetClipboard";

const knob = (col: number, row: number, bind: string): Widget => ({
  type: "knob",
  col,
  row,
  colSpan: 2,
  rowSpan: 2,
  bind,
});

const panel: Record<string, Widget> = {
  g: { type: "group", col: 2, row: 1, colSpan: 4, rowSpan: 2, label: "AMP" },
  dry: knob(2, 1, "Dry"),
  wet: knob(4, 1, "Wet"),
  out: knob(8, 1, "Out"),
};

describe("cut, copy and paste on the grid", () => {
  it("takes a group with what it frames, the group first, and a widget alone", () => {
    expect(clipIds(panel, "g")).toEqual(["g", "dry", "wet"]);
    expect(clipIds(panel, "out")).toEqual(["out"]);
  });

  it("holds a block at positions relative to its top-left, and its size", () => {
    const clip = copyWidgets(panel, "g");
    expect(clip?.cols).toBe(4);
    expect(clip?.rows).toBe(2);
    expect(clip?.widgets.wet).toMatchObject({ col: 2, row: 0, bind: "Wet" });
  });

  it("pastes the block at a cell, renaming what is taken, the head first", () => {
    const clip = copyWidgets(panel, "g");
    if (!clip) throw new Error("no clip");
    const { widgets, first } = pasteWidgets(
      panel,
      clip,
      { col: 0, row: 4 },
      { cols: 14, rows: 8 },
      new Set(),
    );
    expect(first).toBe("g_2");
    expect(widgets.g_2).toMatchObject({ col: 0, row: 4, label: "AMP" });
    expect(widgets.wet_2).toMatchObject({ col: 2, row: 4, bind: "Wet" });
    expect(widgets.g).toEqual(panel.g);
  });

  it("pulls a paste back inside the grid, and avoids an id another page uses", () => {
    const clip = copyWidgets(panel, "out");
    if (!clip) throw new Error("no clip");
    const { widgets, first } = pasteWidgets(
      {},
      clip,
      { col: 13, row: 7 },
      { cols: 14, rows: 8 },
      new Set(["out"]),
    );
    expect(first).toBe("out_2");
    expect(widgets.out_2).toMatchObject({ col: 12, row: 6 });
  });
});
