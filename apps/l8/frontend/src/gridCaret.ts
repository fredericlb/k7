// gridCaret.ts — the timeline's caret and `v` rectangle, restated for a surface whose rows and
// columns are a plain GRID: the piano roll's pitches × ruler steps, the sequencer's rack sounds ×
// steps. Pure arithmetic on indices, so the behaviour can be pinned without mounting a pane.
// See apps/l8/frontend/docs/clipEditors.md.

import type { Clipboard, MaybeClipboard } from "./clipboard";

/** One cell, by index. Row 0 is the TOP row; the surfaces already draw their rows that way. */
export interface GridCell {
  row: number;
  col: number;
}

/**
 * The `v` selection: an anchor that stays and a head that moves — vim's, and the timeline's.
 *
 * Two cells rather than a normalised box, because which end MOVES is the whole of the gesture:
 * growing a rectangle leftwards from its right edge has to keep the right edge still.
 */
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

/**
 * `c` pinned inside the grid.
 *
 * Clamps rather than wraps: the timeline's caret stops at the ends, and a caret that jumped from
 * the last beat to the first would move the eye somewhere it did not ask to go. An empty grid
 * gives `{0,0}` rather than a negative index — the caller draws nothing for it anyway.
 */
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

/** Whether a cell is inside the box — inclusive, so the cell under the head counts. */
export function inBox(box: GridBox, row: number, col: number): boolean {
  return (
    row >= box.rowLo && row <= box.rowHi && col >= box.colLo && col <= box.colHi
  );
}

/**
 * The selection's span in COLUMNS, as a half-open pair — `[lo, hi + 1)`.
 *
 * The +1 is the rule the timeline's loop already follows and the reason this is a function: a
 * rectangle from column 4 to column 4 is one cell WIDE, not zero, so the region it means runs to
 * the far edge of that cell. Reading it as `[lo, hi]` gives an empty loop for a one-cell
 * selection, which reads as "the loop did nothing".
 */
export function colSpan(sel: GridSelection): { from: number; to: number } {
  const b = selBox(sel);
  return { from: b.colLo, to: b.colHi + 1 };
}

/**
 * A grid column as a beat of the SONG — what the transport is told, and the one conversion both
 * clip editors need.
 *
 * The grid's own origin cancels, which is worth stating because it looks like an omission. Both
 * panes draw their first column at the canvas's left edge, and both stack the arrangement ruler
 * over that same edge starting at the placement (`ArrangementRuler`'s `startBeat={clip.start}`).
 * So a column's local beat is `origin + col × unit` and its song beat is
 * `clipStart + (local − origin)` — the origin appears on both sides and falls out. A windowed
 * clip therefore needs no special case: its window moved the local numbering, not where the
 * material plays.
 */
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

/**
 * What the shell drives on whichever clip grid is on screen — the same four things `TimelineHandle`
 * exposes, so `v`, `t` and Shift+L mean one thing wherever the caret is.
 *
 * A handle rather than props because these are COMMANDS: they arrive from the command bar or from
 * a key that names one, and the pane that answers them is the one currently drawn.
 */
export interface ClipGridHandle {
  /** `v` — caret ⇄ rectangle. */
  toggleSelect: () => void;
  /** `t` — send the transport to the caret. */
  seekToCaret: () => void;
  /** Shift+L — the rectangle becomes the loop region, or clears it when there is none. */
  toggleLoop: () => void;
  /** `ui copy` — the rectangle's contents, or null when it holds nothing. */
  copy: () => MaybeClipboard;
  /**
   * `paste` — the command LINE that would put the clipboard down at the caret.
   *
   * A line rather than a write, so the paste goes through the same journalled path a typed
   * command takes: the pane decides WHAT lands where, the shell runs it, and one paste is one
   * Ctrl+Z. `note` is always said — it is the count when there is a line, and the reason when
   * there is not (the wrong kind, nothing that fits).
   */
  pasteLine: (clip: Clipboard) => PasteResult;
}

/** What a pane answers `paste` with: what to run, if anything, and what to say either way. */
export interface PasteResult {
  line?: string;
  note: string;
}

/**
 * Whether a rectangle is live, reported UP rather than asked for.
 *
 * `L` is a conditional binding and has to go quiet with nothing to loop, and a condition is
 * computed in a memo — which cannot read a ref. So the grid pushes the flag the way the timeline
 * pushes `onView`, and the handle above stays the three things the shell CALLS.
 */
export type OnGridSelection = (live: boolean) => void;
