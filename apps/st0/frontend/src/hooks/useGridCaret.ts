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
  /** Start a shift+drag at `c`: the rectangle is anchored where the POINTER pressed, never on the caret or an older rectangle. */
  beginDrag: (c: GridCell) => (next: GridCell | null) => void;
  /** Move the live rectangle by rows and columns: the notes it held were dragged, and it follows them. */
  shiftSelect: (dRow: number, dCol: number) => void;
}

/** The caret over a grid of `bounds`: `active` gates the keys so two surfaces cannot move two carets, and `resetKey` puts it home. */
export function useGridCaret({
  active,
  rows,
  cols,
  resetKey,
  onStatus,
}: {
  active: boolean;
  /** How many rows and columns the surface draws — two NUMBERS, since an inline object would fire the settle effect every render. */
  rows: number;
  cols: number;
  resetKey: string;
  onStatus?: (s: string) => void;
}): GridCaret {
  const bounds = useMemo<GridBounds>(() => ({ rows, cols }), [rows, cols]);
  const [caret, setCaret] = useState<GridCell>({ row: 0, col: 0 });
  const [sel, setSel] = useState<GridSelection | null>(null);

  // Read by the key listener and the drag, so neither rebinds on every head move — the timeline holds its selection in a ref too.
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

  /** The grid changed shape under it: settle rather than draw a caret outside the pane, returning the SAME object when nothing moved. */
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
    const at = clampCell(c, boundsRef.current);
    setCaret(at);
    setSel({ anchor: at, head: at });
    return (next: GridCell | null) => {
      if (!next) return;
      setSel((s) => s && { ...s, head: clampCell(next, boundsRef.current) });
    };
  }, []);

  /** The keys, and ONLY the continuous ones — every discrete action is a command; Escape is swallowed hard, or one press would do two things. */
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

  const shiftSelect = useCallback((dRow: number, dCol: number) => {
    const by = (c: GridCell) =>
      clampCell({ row: c.row + dRow, col: c.col + dCol }, boundsRef.current);
    setSel((s) => (s ? { anchor: by(s.anchor), head: by(s.head) } : s));
  }, []);

  const box = useMemo(() => (sel ? selBox(sel) : null), [sel]);

  return {
    caret,
    sel,
    box,
    toggleSelect,
    clearSelect,
    placeCaret,
    beginDrag,
    shiftSelect,
  };
}
