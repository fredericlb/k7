// useStepPads.ts — what a press on the step sequencer's pads DOES: the ghosts painted before the
// document agrees, the command queue, and the gestures — toggle, velocity drag, ctrl+drag, the
// shift+wheel nudge and a dragged selection. SequencerPanel draws the grid; this decides what a
// pointer on it writes. See ../../docs/clipEditors.md.

import { usePointerFollow } from "@studio/ui-timeline/drag";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clamp } from "../clamp";
import type { MenuCtx } from "../contextMenu";
import { type GridBox, type GridCell, inBox } from "../gridCaret";
import { m } from "../paraglide/messages.js";
import {
  NUDGE_MAX,
  nudgedTime,
  nudgeOf,
  type PadEdit,
  planSelectionMove,
  settledEdits,
} from "../stepGrid";
import type { WebNote } from "../types";
import type { GridCaret } from "./useGridCaret";

/** One row of the grid: a rack sound, or a key the notes use that the rack does not name. */
export interface Row {
  symbol: string;
  note: number;
  known: boolean;
}

// A cell's pixel height (h-14), needed as a NUMBER by the velocity line: 0 at the bottom edge, 1 at the top.
export const CELL_H = 56;
// How long the wheel must be still before a nudge is written — one command for a flick, and letting go still ends the gesture.
const NUDGE_SETTLE_MS = 250;

export function useStepPads({
  clipId,
  seqId,
  step,
  cells,
  rows,
  origin,
  span,
  byCell,
  grid,
  command,
  setStatus,
  onContextMenu,
}: {
  clipId: string;
  /** The sequence every pad command names. */
  seqId: string;
  /** The precision's step, in beats. */
  step: number;
  cells: readonly number[];
  rows: readonly Row[];
  origin: number;
  span: number;
  byCell: ReadonlyMap<string, WebNote>;
  grid: GridCaret;
  command: (line: string) => void | Promise<void>;
  setStatus?: (s: string) => void;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
}) {
  const { box } = grid;
  // One pointer per gesture, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();

  /** Presses the document has not caught up with yet: a press paints at once and the ghost is held until the document AGREES (see `settledEdits`). */
  const [pending, setPending] = useState<ReadonlyMap<string, PadEdit>>(
    new Map(),
  );
  /** A pad key back to its step's beat, through a ref and STABLE — else the reconcile below would run on every render. */
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const cellStartOfKey = useCallback(
    (key: string): number | undefined =>
      cellsRef.current[Number(key.split("@")[1])],
    [],
  );
  const inFlight = useRef(0);
  useEffect(() => {
    setPending((cur) => {
      if (!cur.size) return cur;
      // Nothing in flight and a document has landed: it has the last word, so a ghost that still disagrees was a command that FAILED.
      if (inFlight.current === 0) return new Map();
      const done = settledEdits(cur, byCell, cellStartOfKey, step);
      if (!done.length) return cur;
      const next = new Map(cur);
      for (const k of done) next.delete(k);
      return next;
    });
  }, [byCell, cellStartOfKey, step]);
  // A different clip's ghosts are not this one's — nor a different PRECISION's: an index counts cells of the step it was made at.
  useEffect(() => {
    setPending(new Map());
  }, [clipId, step]);
  const paint = (key: string, edit: PadEdit) =>
    setPending((cur) => new Map(cur).set(key, edit));

  /** The commands, in ORDER and never blocking: serialised because each is a read-modify-write, chained rather than gated. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = (line: string) => {
    inFlight.current++;
    queue.current = queue.current
      .then(() => command(line))
      .catch(() => {})
      .finally(() => {
        inFlight.current--;
      });
  };

  /** Right-click on a PAD: its effects, through the shell's own menu, only on a LIT cell, addressed by the note's REAL start. */
  const onCellMenu = (e: ReactMouseEvent, hit: WebNote | null | undefined) => {
    if (!hit || !onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(
      {
        kind: "pad",
        sequence: seqId,
        note: hit.key,
        start: hit.time,
        ...(hit.repeat ? { repeat: hit.repeat } : {}),
        ...(hit.skip ? { skip: hit.skip } : {}),
      },
      e.clientX,
      e.clientY,
    );
  };

  /** The press on a lit cell, undecided until it travels — the roll's rule and its 4px slop; the live value is a ref, state only for drawing. */
  interface VDrag {
    note: number;
    time: number;
    vel: number;
    moved: boolean;
    /** Ctrl held at the press: this drag MOVES the note instead of setting its velocity. */
    move: boolean;
    /** The cell it started on, so the ghost can be lifted from there on release. */
    fromKey: string;
  }
  const vDrag = useRef<VDrag | null>(null);
  const pressY = useRef(0);

  /** Move the pressed cell's three level layers in place, NOT through React state: a grid of a thousand buttons cannot reconcile per frame. */
  const drawLevel = (cell: Element, vel: number) => {
    const y = (1 - clamp(vel, 0, 1)) * (CELL_H - 1);
    const above = cell.querySelector<HTMLElement>('[data-fill="above"]');
    const below = cell.querySelector<HTMLElement>('[data-fill="below"]');
    const line = cell.querySelector<HTMLElement>('[data-fill="line"]');
    if (above) above.style.height = `${y}px`;
    if (below) below.style.top = `${y}px`;
    if (line) line.style.top = `${y}px`;
  };
  // Whether a press actually STARTED on a cell — a release over one whose press began elsewhere must not write a note.
  const pressed = useRef(false);
  /** A press INSIDE the live rectangle: where it began, and the cell it last said it would drop on. */
  const groupFrom = useRef<GridCell | null>(null);
  const groupAt = useRef("");

  /** The cell under a pointer, read off the DOM the cells already carry — the capture keeps the events on the pressed one. */
  const cellUnder = (x: number, y: number): GridCell | null => {
    const el = document.elementFromPoint(x, y)?.closest?.("[data-col]");
    const row = Number(el?.getAttribute("data-row"));
    const col = Number(el?.getAttribute("data-col"));
    return Number.isFinite(row) && Number.isFinite(col) ? { row, col } : null;
  };
  const planMove = (b: GridBox, dRow: number, dCol: number) =>
    planSelectionMove({
      box: b,
      dRow,
      dCol,
      rowNotes: rows.map((r) => r.note),
      cells,
      byCell,
    });
  const REFUSAL = {
    empty: () => m["seq.moveEmpty"](),
    outside: () => m["seq.moveOutside"](),
    occupied: () => m["seq.moveOccupied"](),
  } as const;

  /** Drop the rectangle `dRow` rows and `dCol` steps away: one command for every note, the pads painted at once, the rectangle following. */
  const moveSelection = (b: GridBox, dRow: number, dCol: number) => {
    const plan = planMove(b, dRow, dCol);
    if ("refused" in plan) {
      setStatus?.(REFUSAL[plan.refused]());
      return;
    }
    setPending((cur) => {
      const next = new Map(cur);
      for (const k of plan.lift) next.set(k, { on: false });
      for (const l of plan.land) next.set(l.key, { on: true, vel: l.vel });
      return next;
    });
    run(`sequence notes move ${seqId} ${JSON.stringify(plan.moves)}`);
    grid.shiftSelect(dRow, dCol);
    const n = plan.moves.length;
    setStatus?.(m["seq.moved"]({ n, s: n > 1 ? "s" : "" }));
  };

  const onCellDown = (
    e: React.PointerEvent,
    row: Row,
    hit: WebNote | null,
    at: { row: number; col: number },
  ) => {
    /** The PRIMARY button only, and load-bearing: without it a right-click runs the press path, removing the pad AND opening the wrong menu. */
    if (e.button !== 0) return;
    e.preventDefault();
    /** SHIFT: the caret grows into the rectangle, before the note gestures, with the head's cell read off the DOM the cells already carry. */
    if (e.shiftKey) {
      const feed = grid.beginDrag(at);
      const onSelMove = (ev: PointerEvent) => {
        const el = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest?.("[data-col]");
        const r = Number(el?.getAttribute("data-row"));
        const c = Number(el?.getAttribute("data-col"));
        feed(
          Number.isFinite(r) && Number.isFinite(c) ? { row: r, col: c } : null,
        );
      };
      // The rectangle stays as drawn whichever way the gesture ends.
      follow(e, { move: onSelMove });
      return;
    }
    // Captured for both cases: the release then lands on the PRESSED cell wherever the pointer went.
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    pressY.current = e.clientY;
    // Inside the live rectangle the press MOVES what it holds, decided on release: one that never leaves its cell is still a click.
    if (box && inBox(box, at.row, at.col)) {
      groupFrom.current = at;
      groupAt.current = "";
      return;
    }
    // A press is also where you are: the caret follows it, and any live rectangle goes — two cannot both be current.
    grid.placeCaret(at);
    if (!hit) return; // an empty cell has only the toggle — see onCellUp
    vDrag.current = {
      note: row.note,
      time: hit.time,
      vel: hit.vel ?? 1,
      moved: false,
      // Ctrl (or Cmd) at the PRESS decides which gesture this is, and it cannot change mid-drag.
      move: e.ctrlKey || e.metaKey,
      fromKey: e.currentTarget.getAttribute("data-key") ?? "",
    };
  };
  const onCellMove = (e: React.PointerEvent) => {
    const from = groupFrom.current;
    if (from && box) {
      // Said in the status line only when the drop cell changes: a grid of buttons is not redrawn per pointer event.
      const to = cellUnder(e.clientX, e.clientY);
      const where = to ? `${to.row}:${to.col}` : "";
      if (!to || where === groupAt.current) return;
      groupAt.current = where;
      const dRow = to.row - from.row;
      const dCol = to.col - from.col;
      if (!dRow && !dCol) return;
      const plan = planMove(box, dRow, dCol);
      const n = "moves" in plan ? plan.moves.length : 0;
      setStatus?.(
        "refused" in plan
          ? REFUSAL[plan.refused]()
          : m["seq.moving"]({
              n,
              s: n > 1 ? "s" : "",
              steps: dCol,
              rows: dRow,
            }),
      );
      return;
    }
    const d = vDrag.current;
    if (!d) return;
    // A ctrl-drag is going somewhere else; its own cell's level must not follow the pointer.
    if (d.move) {
      d.moved = true;
      return;
    }
    if (!d.moved && Math.abs(e.clientY - pressY.current) < 4) return;
    // Where the pointer sits inside the cell, bottom-up — the roll's velAt at a fixed height.
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    d.vel = clamp(1 - y / (CELL_H - 1), 0, 1);
    d.moved = true;
    drawLevel(e.currentTarget, d.vel);
  };
  /** --- shift + wheel: NUDGE the pad under the cursor, in hundredths of its own step and bounded 0..99 (docs/clipEditors.md). */
  const nudgeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = nudgeTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const onCellWheel = (
    e: React.WheelEvent,
    row: Row,
    hit: WebNote | null,
    cellStart: number,
  ) => {
    if (!e.shiftKey || !hit) return;
    e.preventDefault();
    e.stopPropagation();
    const key = e.currentTarget.getAttribute("data-key") ?? "";
    const from = nudgeOf(hit.time, cellStart, step);
    // Up is later, down is earlier — the wheel's own direction, and the same one the velocity drag reads.
    const to = clamp(from + (e.deltaY < 0 ? 1 : -1), 0, NUDGE_MAX);
    if (to === from) return;
    paint(key, { on: true, vel: hit.vel, nudge: to });

    /** The command waits for the wheel to STOP: a flick is twenty notches, so one command, one journal line, one Ctrl+Z. */
    const prev = nudgeTimers.current.get(key);
    if (prev) clearTimeout(prev);
    const at = hit.time;
    nudgeTimers.current.set(
      key,
      setTimeout(() => {
        nudgeTimers.current.delete(key);
        const landed = nudgedTime(cellStart, step, to);
        if (Math.abs(landed - at) < 1e-9) return;
        run(
          `sequence note move ${seqId} ${row.note} ${at} ${row.note} ${landed}`,
        );
      }, NUDGE_SETTLE_MS),
    );
  };

  const onCellUp = (e: React.PointerEvent, row: Row, hit: WebNote | null) => {
    const d = vDrag.current;
    const began = pressed.current;
    pressed.current = false;
    vDrag.current = null;
    const from = groupFrom.current;
    groupFrom.current = null;
    if (!began) return;
    if (from) {
      const to = cellUnder(e.clientX, e.clientY);
      if (box && to && (to.row !== from.row || to.col !== from.col)) {
        moveSelection(box, to.row - from.row, to.col - from.col);
        return;
      }
      // It never left its cell: a click, so the caret goes there and the rectangle with it — then the toggle below.
      grid.placeCaret(from);
    }
    const key = e.currentTarget.getAttribute("data-key") ?? "";

    /** A ctrl-drag MOVES the note to the cell it was released over, by point rather than by target, and does nothing on an occupied one. */
    if (hit && d?.move) {
      const to = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-key]");
      const toKey = to?.getAttribute("data-key") ?? "";
      const toNote = Number(to?.getAttribute("data-note"));
      const toStart = Number(to?.getAttribute("data-cell"));
      if (
        !toKey ||
        toKey === d.fromKey ||
        !Number.isFinite(toNote) ||
        !Number.isFinite(toStart) ||
        byCell.has(toKey) ||
        pending.get(toKey)?.on
      )
        return;
      // Lifted from one cell and put down on the other, at once — the document is ~400 ms away.
      setPending((cur) =>
        new Map(cur)
          .set(d.fromKey, { on: false })
          .set(toKey, { on: true, vel: hit.vel ?? 1 }),
      );
      run(
        `sequence note move ${seqId} ${row.note} ${hit.time} ${toNote} ${toStart}`,
      );
      return;
    }
    if (hit && d?.moved) {
      // Two decimals, like the roll's drag: a file full of 0.7333333333 is noise in a diff.
      const v = Math.round(clamp(d.vel, 0, 1) * 100) / 100;
      paint(key, { on: true, vel: v });
      run(`sequence note velocity ${seqId} ${row.note} ${hit.time} ${v}`);
      return;
    }
    // A press that never travelled: the toggle, off at the note's REAL start and on for one step, clamped to the window.
    const cellStart = Number(e.currentTarget.getAttribute("data-cell"));
    if (!Number.isFinite(cellStart)) return;
    paint(key, hit ? { on: false } : { on: true, vel: 1 });
    run(
      hit
        ? `sequence note remove ${seqId} ${row.note} ${hit.time}`
        : `sequence note new ${seqId} ${row.note} ${cellStart} ${Math.min(cellStart + step, origin + span)}`,
    );
  };

  return { pending, onCellDown, onCellMove, onCellUp, onCellWheel, onCellMenu };
}
