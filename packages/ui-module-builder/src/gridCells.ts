// gridCells.ts — the widget grid's cell arithmetic: a widget's span and the cells it covers, the
// first free cell, a resize's fixed corner and the box it draws, the paint order, and a fresh id.
// Pure, so the grid editor keeps only the gestures.

import type { Widget } from "./moduleUi";

export const span = (n?: number) => Math.max(1, n ?? 1);
const covers = (w: Widget, c: number, r: number) =>
  c >= w.col &&
  c < w.col + span(w.colSpan) &&
  r >= w.row &&
  r < w.row + span(w.rowSpan);

// The first cell in `box` no widget covers, row-major; a group frames cells rather than filling them.
export function firstFree(
  widgets: Record<string, Widget>,
  box: { col: number; row: number; cols: number; rows: number },
): { col: number; row: number } {
  const ws = Object.values(widgets).filter((w) => w.type !== "group");
  for (let r = box.row; r < box.row + box.rows; r++)
    for (let c = box.col; c < box.col + box.cols; c++)
      if (!ws.some((w) => covers(w, c, r))) return { col: c, row: r };
  return { col: box.col, row: box.row }; // full — stack on the corner, the user can move it
}

export type Cell = { col: number; row: number };

/** A resize handle, named by the corner it sits on. */
export type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

/** The cell a corner's resize keeps still — the widget's OPPOSITE corner cell. */
export function cornerAnchor(w: Widget, corner: Corner): Cell {
  return {
    col: corner.includes("w") ? w.col + span(w.colSpan) - 1 : w.col,
    row: corner.includes("n") ? w.row + span(w.rowSpan) - 1 : w.row,
  };
}

/** The box spanning two cells, whichever way round they are — so a handle dragged past the anchor flips. */
export function boxBetween(a: Cell, b: Cell) {
  return {
    col: Math.min(a.col, b.col),
    row: Math.min(a.row, b.row),
    colSpan: Math.abs(a.col - b.col) + 1,
    rowSpan: Math.abs(a.row - b.row) + 1,
  };
}

// A group is drawn UNDER what it frames, so it comes first; the sort is stable for everything else.
export const groupsFirst = (ws: Record<string, Widget>): [string, Widget][] =>
  Object.entries(ws).sort(
    ([, a], [, b]) => +(b.type === "group") - +(a.type === "group"),
  );

// A stable, unused id across the WHOLE panel, every tab's included — ids are the override key and never renumber.
export function nextId(taken: Set<string>): string {
  for (let i = 1; ; i++) if (!taken.has(`w${i}`)) return `w${i}`;
}
