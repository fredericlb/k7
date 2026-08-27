// gridCaret.ts — the timeline's caret and `v` rectangle, restated for a surface whose rows and
// columns are a plain GRID: the piano roll's pitches × ruler steps, the sequencer's rack sounds ×
// steps. Pure arithmetic on indices, so the behaviour can be pinned without mounting a pane.
// See apps/st0/frontend/docs/clipEditors.md.

import type { Clipboard, MaybeClipboard } from "./clipboard";

/** One cell, by index. Row 0 is the TOP row; the surfaces already draw their rows that way. */
export interface GridCell {
  row: number;
  col: number;
}

/** The `v` selection: an anchor that stays and a head that moves — two cells, because which end MOVES is the whole of the gesture. */
export interface GridSelection {
  anchor: GridCell;
  head: GridCell;
}

/** How big the grid is. A surface with no rows or no columns has no cell to put a caret in. */
export interface GridBounds {
  rows: number;
  cols: number;
}

/** A selection as a normalised box, INCLUSIVE at both ends — what a drawing and a hit test want. */
export interface GridBox {
  rowLo: number;
  rowHi: number;
  colLo: number;
  colHi: number;
}

/** `c` pinned inside the grid — clamped rather than wrapped, and an empty grid gives `{0,0}` rather than a negative index. */
export function clampCell(c: GridCell, b: GridBounds): GridCell {
  return {
    row: Math.max(0, Math.min(Math.round(c.row), Math.max(0, b.rows - 1))),
    col: Math.max(0, Math.min(Math.round(c.col), Math.max(0, b.cols - 1))),
  };
}

/** `c` moved by a whole number of rows and columns, clamped. */
export function moveCell(
  c: GridCell,
  dRow: number,
  dCol: number,
  b: GridBounds,
): GridCell {
  return clampCell({ row: c.row + dRow, col: c.col + dCol }, b);
}

/** The rectangle two cells describe, whichever end was dragged. */
export function selBox(sel: GridSelection): GridBox {
  return {
    rowLo: Math.min(sel.anchor.row, sel.head.row),
    rowHi: Math.max(sel.anchor.row, sel.head.row),
    colLo: Math.min(sel.anchor.col, sel.head.col),
    colHi: Math.max(sel.anchor.col, sel.head.col),
  };
}

/** The caret's own cell as a box — the one-by-one rectangle a copy falls back on, so ⌃C copies what you are pointing at. */
export const cellBox = (c: GridCell): GridBox => ({
  rowLo: c.row,
  rowHi: c.row,
  colLo: c.col,
  colHi: c.col,
});

/** Whether a cell is inside the box — inclusive, so the cell under the head counts. */
export function inBox(box: GridBox, row: number, col: number): boolean {
  return (
    row >= box.rowLo && row <= box.rowHi && col >= box.colLo && col <= box.colHi
  );
}

/** The selection's span in COLUMNS, half-open: a rectangle from column 4 to column 4 is one cell WIDE, not zero. */
export function colSpan(sel: GridSelection): { from: number; to: number } {
  const b = selBox(sel);
  return { from: b.colLo, to: b.colHi + 1 };
}

/** A grid column as a beat of the SONG — the grid's own origin cancels, so a windowed clip needs no special case. */
export function songBeatOfCol(
  col: number,
  unit: number,
  clipStart: number,
): number {
  return clipStart + col * unit;
}

/** …and in seconds, which is the unit every transport call in this app takes. */
export function songSecondsOfCol(
  col: number,
  unit: number,
  clipStart: number,
  tempo: number,
): number {
  return (songBeatOfCol(col, unit, clipStart) * 60) / Math.max(1e-6, tempo);
}

/** What the shell drives on whichever clip grid is on screen — a handle rather than props, because these are COMMANDS. */
export interface ClipGridHandle {
  /** `v` — caret ⇄ rectangle. */
  toggleSelect: () => void;
  /** `t` — send the transport to the caret. */
  seekToCaret: () => void;
  /** Shift+L — the rectangle becomes the loop region, or clears it when there is none. */
  toggleLoop: () => void;
  /** `selection copy` — the rectangle's contents, or null when it holds nothing. */
  copy: () => MaybeClipboard;
  /** `selection paste` — the command LINE that would put the clipboard down at the caret, so one paste is one Ctrl+Z. */
  pasteLine: (clip: Clipboard) => PasteResult;
  /** `selection delete` — the LINE that removes what the caret or the rectangle points at; absent on a grid that deletes by clicking. */
  deleteLine?: () => PasteResult;
}

/** What a pane answers `selection paste` with: what to run, if anything, and what to say. */
export interface PasteResult {
  line?: string;
  note: string;
}

/** Whether a rectangle is live, reported UP rather than asked for: a condition is computed in a memo, which cannot read a ref. */
export type OnGridSelection = (live: boolean) => void;
