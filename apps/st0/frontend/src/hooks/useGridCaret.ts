// useGridCaret.ts — the timeline's caret behaviour on a clip editor's grid: hjkl/arrows move it,
// `v` grows it into a rectangle, Escape drops that, shift+drag draws one with the pointer. The
// arithmetic is gridCaret.ts; what is here is the state, the key listener and the drag.
// See apps/st0/frontend/docs/clipEditors.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampCell,
  type GridBounds,
  type GridBox,
  type GridCell,
  type GridSelection,
  moveCell,
  selBox,
} from "../gridCaret";

export interface GridCaret {
  caret: GridCell;
  sel: GridSelection | null;
  /** The rectangle, normalised — null when nothing is selected. */
  box: GridBox | null;
  /** `v`: caret ⇄ rectangle. Anchors where the caret is; a second press drops it there. */
  toggleSelect: () => void;
  /** Escape's other caller — the pane's ✕, a mode switch. Leaves the caret where the head was. */
  clearSelect: () => void;
  /** Put the caret somewhere (a click). Drops any rectangle: two selections cannot both be live. */
  placeCaret: (c: GridCell) => void;
  /**
   * Start a shift+drag at `c`. Anchors on the existing rectangle if there is one, else on the
   * caret, exactly as the timeline's does — so shift-clicking EXTENDS rather than restarting.
   * The caller feeds it cells as the pointer moves and calls the returned end on release.
   */
  beginDrag: (c: GridCell) => (next: GridCell | null) => void;
}

/**
 * The caret over a grid of `bounds`.
 *
 * `active` gates the key listener the way `TimelineTab`'s does: two surfaces both answering the
 * arrows would move two carets on one press. It is the pane's own "am I the one on screen".
 *
 * `resetKey` puts the caret home and drops the rectangle — a different clip, a different view of
 * it. The caret is about what you are looking at, so it does not survive being pointed elsewhere.
 */
export function useGridCaret({
  active,
  rows,
  cols,
  resetKey,
  onStatus,
}: {
  active: boolean;
  /** How many rows and columns the surface draws. Two NUMBERS, not a bounds object: an object
   *  built inline is a new identity every render, which would fire the settle effect below on
   *  each one — and settling calls setState, so that is a render loop rather than a slow pane. */
  rows: number;
  cols: number;
  resetKey: string;
  onStatus?: (s: string) => void;
}): GridCaret {
  const bounds = useMemo<GridBounds>(() => ({ rows, cols }), [rows, cols]);
  const [caret, setCaret] = useState<GridCell>({ row: 0, col: 0 });
  const [sel, setSel] = useState<GridSelection | null>(null);

  // Read by the key listener and the drag, so neither rebinds on every head move — the timeline
  // holds its selection in a ref for exactly this reason.
  const selRef = useRef<GridSelection | null>(sel);
  selRef.current = sel;
  const caretRef = useRef<GridCell>(caret);
  caretRef.current = caret;
  const boundsRef = useRef<GridBounds>(bounds);
  boundsRef.current = bounds;

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the TRIGGER — a new clip or view, not a value this body reads.
  useEffect(() => {
    setCaret({ row: 0, col: 0 });
    setSel(null);
  }, [resetKey]);

  /**
   * The grid changed shape under it — a rack lost a sound, the precision halved the steps, the
   * roll's zoom re-picked its unit. Settle rather than draw a caret outside the pane, which is
   * the timeline's `clampCaret` on a row-list change.
   *
   * Every branch returns the SAME object when nothing moved, and that is not tidiness: the roll's
   * column count follows the zoom, so this effect fires on every wheel notch. Returning a fresh
   * `{row, col}` each time would re-render the whole roll on each one, to write the numbers it
   * already had.
   */
  useEffect(() => {
    const same = (a: GridCell, b: GridCell) =>
      a.row === b.row && a.col === b.col;
    setCaret((c) => {
      const next = clampCell(c, bounds);
      return same(c, next) ? c : next;
    });
    setSel((s) => {
      if (!s) return s;
      const anchor = clampCell(s.anchor, bounds);
      const head = clampCell(s.head, bounds);
      return same(s.anchor, anchor) && same(s.head, head)
        ? s
        : { anchor, head };
    });
  }, [bounds]);

  const toggleSelect = useCallback(() => {
    const s = selRef.current;
    if (s) {
      setSel(null);
      setCaret(clampCell(s.head, boundsRef.current));
      return;
    }
    const at = clampCell(caretRef.current, boundsRef.current);
    setSel({ anchor: at, head: at });
  }, []);

  const clearSelect = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    setSel(null);
    setCaret(clampCell(s.head, boundsRef.current));
  }, []);

  const placeCaret = useCallback((c: GridCell) => {
    setSel(null);
    setCaret(clampCell(c, boundsRef.current));
  }, []);

  const beginDrag = useCallback((c: GridCell) => {
    const anchor =
      selRef.current?.anchor ?? clampCell(caretRef.current, boundsRef.current);
    setSel({ anchor, head: clampCell(c, boundsRef.current) });
    return (next: GridCell | null) => {
      if (!next) return;
      setSel((s) => s && { ...s, head: clampCell(next, boundsRef.current) });
    };
  }, []);

  /**
   * The keys, and ONLY the continuous ones — every discrete action is a command in `keys.ts`, the
   * line that file draws and this one keeps. Capture phase and a hard swallow for Escape, both
   * copied from the timeline for the same reason: bubbling, Escape would drop the rectangle AND
   * be read by the shell as "close the pane", so one press would do two things.
   */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      const selecting = !!selRef.current;
      if (selecting && e.key === "Escape") {
        clearSelect();
        onStatus?.("selection cancelled");
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      let dRow = 0;
      let dCol = 0;
      if (e.key === "ArrowLeft" || e.key === "h") dCol = -1;
      else if (e.key === "ArrowRight" || e.key === "l") dCol = 1;
      else if (e.key === "ArrowUp" || e.key === "k") dRow = -1;
      else if (e.key === "ArrowDown" || e.key === "j") dRow = 1;
      else return;
      if (selecting)
        setSel(
          (s) =>
            s && {
              ...s,
              head: moveCell(s.head, dRow, dCol, boundsRef.current),
            },
        );
      else setCaret((c) => moveCell(c, dRow, dCol, boundsRef.current));
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, clearSelect, onStatus]);

  const box = useMemo(() => (sel ? selBox(sel) : null), [sel]);

  return {
    caret,
    sel,
    box,
    toggleSelect,
    clearSelect,
    placeCaret,
    beginDrag,
  };
}
