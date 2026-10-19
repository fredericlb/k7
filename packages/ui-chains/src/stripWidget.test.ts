import type { WebModuleUI } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { nodeSize, stripWidgetRect, widgetRect } from "./graph";

// The strip's own panel, as packages/song/meta/audio/mixer/ui.k7x declares it.
const ui: WebModuleUI = {
  cols: 2,
  rows: 4,
  widgets: {
    vol: { type: "fader", col: 0, row: 0, rowSpan: 3, bind: "Volume" },
    pan: { type: "knob", col: 0, row: 3, bind: "Pan" },
    high: { type: "knob", col: 1, row: 0, bind: "High" },
  },
};
const { vol, pan, high } = ui.widgets;
const natural = nodeSize(ui).h;

describe("stripWidgetRect", () => {
  it("gives the fader the extra height and moves what is under it down", () => {
    const n = { strip: true, ui, h: natural + 100 };
    expect(stripWidgetRect(n, vol).h).toBe(widgetRect(vol).h + 100);
    expect(stripWidgetRect(n, pan).y).toBe(widgetRect(pan).y + 100);
    expect(stripWidgetRect(n, high)).toEqual(widgetRect(high));
  });

  it("changes nothing at the grid's own height, or on a card that is not a strip", () => {
    expect(stripWidgetRect({ strip: true, ui, h: natural }, vol)).toEqual(
      widgetRect(vol),
    );
    expect(stripWidgetRect({ ui, h: natural + 100 }, vol)).toEqual(
      widgetRect(vol),
    );
  });
});
