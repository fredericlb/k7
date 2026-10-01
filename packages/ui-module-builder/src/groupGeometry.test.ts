// A group frames what lies wholly inside its box and holds none of it: these are the rules the grid
// editor and AI organize's check both apply, so a panel the one accepts is one the other accepts.

import type { Widget } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { clash, framedBy, inside, overlaps } from "./groupGeometry";

const group: Widget = { type: "group", col: 2, row: 1, colSpan: 4, rowSpan: 2 };
const knob = (col: number, row: number): Widget => ({
  type: "knob",
  col,
  row,
  colSpan: 2,
  rowSpan: 2,
});

describe("a group's box", () => {
  it("contains a widget wholly inside it, and not one that straddles its edge", () => {
    expect(inside(knob(2, 1), group)).toBe(true);
    expect(inside(knob(4, 1), group)).toBe(true);
    expect(inside(knob(5, 1), group)).toBe(false);
    expect(overlaps(knob(5, 1), group)).toBe(true);
  });

  it("clashes with a straddling widget and with another group, never with what it frames", () => {
    expect(clash(group, knob(2, 1))).toBe(false);
    expect(clash(knob(2, 1), group)).toBe(false);
    expect(clash(group, knob(5, 1))).toBe(true);
    expect(clash(group, { ...group, col: 3 })).toBe(true);
    expect(clash(knob(2, 1), knob(3, 1))).toBe(true);
    expect(clash(group, knob(8, 1))).toBe(false);
  });

  it("frames the widgets inside it — the ones a move carries along — and no group", () => {
    const widgets: Record<string, Widget> = {
      dry: knob(2, 1),
      wet: knob(4, 1),
      out: knob(6, 1),
      g: group,
    };
    expect(framedBy(widgets, group)).toEqual(["dry", "wet"]);
  });
});
