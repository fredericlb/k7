// Every corner of a widget resizes it: the handle's OPPOSITE corner stays put, and dragging past it
// flips the box rather than collapsing it. What a corner drag writes is pinned here, since nothing
// mounts the grid.

import type { Widget } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { boxBetween, cornerAnchor } from "./WidgetGridEditor";

const knob: Widget = { type: "knob", col: 2, row: 1, colSpan: 2, rowSpan: 2 };

describe("resizing from a corner", () => {
  it("anchors the corner opposite the handle", () => {
    expect(cornerAnchor(knob, "se")).toEqual({ col: 2, row: 1 });
    expect(cornerAnchor(knob, "nw")).toEqual({ col: 3, row: 2 });
    expect(cornerAnchor(knob, "ne")).toEqual({ col: 2, row: 2 });
    expect(cornerAnchor(knob, "sw")).toEqual({ col: 3, row: 1 });
  });

  it("grows up and left from the top-left handle, keeping the bottom-right still", () => {
    expect(boxBetween(cornerAnchor(knob, "nw"), { col: 0, row: 0 })).toEqual({
      col: 0,
      row: 0,
      colSpan: 4,
      rowSpan: 3,
    });
  });

  it("flips rather than collapses when a handle crosses its anchor", () => {
    expect(boxBetween(cornerAnchor(knob, "se"), { col: 0, row: 1 })).toEqual({
      col: 0,
      row: 1,
      colSpan: 3,
      rowSpan: 1,
    });
  });
});
