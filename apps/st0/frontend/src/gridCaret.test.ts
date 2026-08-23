// The caret and the `v` rectangle, on the grid the clip editors draw. Pure, so the behaviour the
// timeline established can be pinned here without mounting a pane — which is the only kind of
// proof this app's test suite gives (see AGENTS.md's Verify).

import { describe, expect, it } from "vitest";
import {
  cellBox,
  clampCell,
  colSpan,
  type GridSelection,
  inBox,
  moveCell,
  selBox,
} from "./gridCaret";

const B = { rows: 4, cols: 8 };

describe("the caret", () => {
  it("moves by whole cells", () => {
    expect(moveCell({ row: 1, col: 2 }, 1, -1, B)).toEqual({ row: 2, col: 1 });
  });

  it("STOPS at the ends rather than wrapping", () => {
    // The timeline's rule: a caret that jumped from the last beat to the first would move the eye somewhere it did not ask to go.
    expect(moveCell({ row: 0, col: 0 }, -1, -1, B)).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 3, col: 7 }, 1, 1, B)).toEqual({ row: 3, col: 7 });
  });

  it("is pinned back inside a grid that shrank under it", () => {
    // Rows and columns come and go — a rack loses a sound, a precision change halves the steps.
    expect(clampCell({ row: 9, col: 9 }, B)).toEqual({ row: 3, col: 7 });
  });

  it("gives a real cell for an empty grid rather than a negative index", () => {
    expect(clampCell({ row: 2, col: 2 }, { rows: 0, cols: 0 })).toEqual({
      row: 0,
      col: 0,
    });
  });
});

describe("the rectangle", () => {
  const sel = (a: [number, number], h: [number, number]): GridSelection => ({
    anchor: { row: a[0], col: a[1] },
    head: { row: h[0], col: h[1] },
  });

  it("reads the same whichever end was dragged", () => {
    expect(selBox(sel([1, 2], [3, 5]))).toEqual(selBox(sel([3, 5], [1, 2])));
  });

  it("is INCLUSIVE at both ends — the cell under the head is in it", () => {
    const box = selBox(sel([1, 2], [3, 5]));
    expect(inBox(box, 3, 5)).toBe(true);
    expect(inBox(box, 1, 2)).toBe(true);
    expect(inBox(box, 0, 2)).toBe(false);
    expect(inBox(box, 1, 6)).toBe(false);
  });

  it("holds one cell when it has not been grown", () => {
    expect(selBox(sel([2, 3], [2, 3]))).toEqual({
      rowLo: 2,
      rowHi: 2,
      colLo: 3,
      colHi: 3,
    });
  });

  // …and with NO rectangle at all the caret is that same one-cell box, fed to the very code path a drawn rectangle feeds.
  it("the caret's own cell IS a rectangle — the one a copy falls back on", () => {
    expect(cellBox({ row: 2, col: 3 })).toEqual(selBox(sel([2, 3], [2, 3])));
  });
});

describe("the span a transport reads", () => {
  it("runs to the FAR edge of the last column", () => {
    // The +1 is the whole point, and the timeline's loop makes it too: [4,4] must mean [4,5) and not an empty region.
    expect(
      colSpan({ anchor: { row: 0, col: 4 }, head: { row: 0, col: 4 } }),
    ).toEqual({ from: 4, to: 5 });
    expect(
      colSpan({ anchor: { row: 0, col: 2 }, head: { row: 1, col: 6 } }),
    ).toEqual({ from: 2, to: 7 });
  });

  it("does not care which end was dragged either", () => {
    expect(
      colSpan({ anchor: { row: 0, col: 6 }, head: { row: 0, col: 2 } }),
    ).toEqual({ from: 2, to: 7 });
  });
});
