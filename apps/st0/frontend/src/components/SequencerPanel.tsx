// SequencerPanel.tsx — a MIDI clip whose track feeds a RACK, edited as a STEP SEQUENCER: one
// row per rack sound — plus one per key the notes use that the rack does not name — a fixed
// grid of cells over the clip's window, a lit cell = "this sound hits here". The precision
// (1/2 … 1/16 notes) is the person's, per panel. A press toggles; a vertical DRAG on a lit
// cell is the roll's velocity gesture, restated for a button. Every commit is one note
// command — one line, one Ctrl+Z — and the grid redraws from the reload it triggers.

import { Grip } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { WebRackSound } from "@studio/graph-model";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { copyNotes, droppedCount, pasteNotes } from "../clipboard";
import { clipLoop } from "../clipLoop";
import type { MenuCtx } from "../contextMenu";
import {
  type ClipGridHandle,
  cellBox,
  colSpan,
  inBox,
  type OnGridSelection,
  selBox,
  songSecondsOfCol,
} from "../gridCaret";
import { useGridCaret } from "../hooks/useGridCaret";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { m } from "../paraglide/messages.js";
import {
  NUDGE_MAX,
  notesByCell,
  nudgedTime,
  nudgeOf,
  type PadEdit,
  PRECISIONS,
  type Precision,
  settledEdits,
  stepCells,
  unknownKeys,
} from "../stepGrid";
import type { WebClip, WebNote, WebProject } from "../types";
import { noteName } from "./PianoRoll";
import { SeqDoubleButton } from "./SeqDoubleButton";

// A cell's pixel height (h-14), needed as a NUMBER by the velocity line: 0 at the bottom edge, 1 at the top.
const CELL_H = 56;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
// How long the wheel must be still before a nudge is written — one command for a flick, and letting go still ends the gesture.
const NUDGE_SETTLE_MS = 250;

/** One row of the grid: a rack sound, or a key the notes use that the rack does not name. */
interface Row {
  symbol: string;
  note: number;
  known: boolean;
}

export function SequencerPanel({
  project,
  clip,
  rack,
  modes,
  command,
  caretRef,
  active = true,
  setStatus,
  onSelection,
  onSeek,
  onSetLoop,
  onContextMenu,
}: {
  project: WebProject;
  clip: WebClip;
  /** The downstream rack's sounds, in symbol order — the rows. See rackFor.ts. */
  rack: WebRackSound[];
  /** The view switch at the end of the header — the same control the other two views carry (ClipViewModes.tsx). */
  modes?: ReactNode;
  /** Runs a command line through the shell, which journals it — one press, one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  /** Where the shell reaches the caret: `v`, `t` and Shift+L are commands, so they arrive from the bar (ClipView's ClipViewHandle). */
  caretRef?: RefObject<ClipGridHandle | null>;
  /** Whether this pane owns the keys — the arrows must not move two carets at once. */
  active?: boolean;
  setStatus?: (s: string) => void;
  /** Whether a rectangle is live — pushed up, since a condition cannot read a ref. */
  onSelection?: OnGridSelection;
  /** Seek the transport, in SONG seconds — what `t` on the caret does. */
  onSeek?: (seconds: number) => void;
  /** Set or clear the transport's loop region, in SONG seconds — Shift+L on the rectangle. */
  onSetLoop?: (fromSec: number, toSec: number, on: boolean) => void;
  /** The shell's right-click menu, for a pad's effects. Absent ⇒ the browser's own. */
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
}) {
  const notes = clip.notes;
  const seqId = clip.name || clip.id;
  const barBeats = Math.max(1, project.timeSigNumerator || 4);
  // The window the grid divides — the clip's own cage, as the roll's; a step grid has no fit question, the window IS the grid.
  const loop = clipLoop(clip);
  const extent =
    Math.ceil(
      notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / barBeats,
    ) * barBeats;
  const origin = loop?.from ?? 0;
  const span = loop
    ? loop.win
    : clip.length > 0
      ? clip.length
      : Math.max(barBeats, extent);

  const [prec, setPrec] = useState<Precision>(PRECISIONS[2]); // 1/8 by default
  const cells = stepCells(origin, span, prec.beats);
  // The rack's rows first, in its own order, then a row per unnamed key the notes use, high first: a played take must SHOW.
  const rows: Row[] = [
    ...rack.map((r) => ({ symbol: r.symbol, note: r.note, known: true })),
    ...unknownKeys(
      notes,
      rack.map((r) => r.note),
      origin,
      span,
    ).map((k) => ({ symbol: noteName(k), note: k, known: false })),
  ];

  // A different clip starts over: the precision belongs to what you were looking at.
  useEffect(() => {
    setPrec(PRECISIONS[2]);
  }, [clip.id]);

  /** The caret and its `v` rectangle on this grid (gridCaret.ts), keyed on the precision too: a step is a different width at 1/8 than at 1/16. */
  const grid = useGridCaret({
    active,
    rows: rows.length,
    cols: cells.length,
    resetKey: `${clip.id}@${prec.beats}`,
    onStatus: setStatus,
  });
  const { caret, box } = grid;

  // What the transport is told: a column's own beat of the song, through the placement — see songBeatOfCol.
  const secondsOfCol = useCallback(
    (col: number) =>
      songSecondsOfCol(col, prec.beats, clip.start, project.tempo),
    [prec.beats, clip.start, project.tempo],
  );

  // What the rectangle is, in words — a wash of colour does not say how many steps it covers or what to press next.
  useEffect(() => {
    if (!active || !box) return;
    const steps = box.colHi - box.colLo + 1;
    const lanes = box.rowHi - box.rowLo + 1;
    setStatus?.(m["seq.selection"]({ steps, lanes, s: lanes > 1 ? "s" : "" }));
  }, [active, box, setStatus]);

  useImperativeHandle(
    caretRef,
    (): ClipGridHandle => ({
      toggleSelect: grid.toggleSelect,
      // `t`: the caret's step, as a moment in the song.
      seekToCaret: () => onSeek?.(secondsOfCol(caret.col)),
      /** Shift+L: the rectangle becomes the loop region, out to the FAR edge of its last step; with none it CLEARS. */
      toggleLoop: () => {
        const s = grid.sel;
        if (!s) {
          onSetLoop?.(0, 0, false);
          return;
        }
        const { from, to } = colSpan(s);
        onSetLoop?.(secondsOfCol(from), secondsOfCol(to), true);
        grid.clearSelect();
      },
      /** `selection copy` — the notes the rectangle holds; a row is a rack SOUND, so the corner is taken through the rows' own notes. */
      copy: () => {
        const s = grid.sel;
        // No rectangle: the caret's own cell is one (gridCaret's `cellBox`), and an empty one answers null.
        const b = s ? selBox(s) : cellBox({ row: caret.row, col: caret.col });
        const keys = rows.slice(b.rowLo, b.rowHi + 1).map((r) => r.note);
        if (!keys.length) return null;
        return copyNotes(
          notes,
          seqId,
          Math.min(...keys),
          Math.max(...keys),
          cells[b.colLo] ?? origin,
          (cells[b.colHi] ?? origin) + prec.beats,
        );
      },
      /** `selection paste` — one `sequence note add`, landing the rectangle's corner on the caret's cell. */
      pasteLine: (c) => {
        if (c.kind !== "notes")
          return {
            note: m["grid.clipboardHasEvents"](),
          };
        const topKey = rows[caret.row]?.note;
        if (topKey === undefined) return { note: m["grid.noRowUnderCaret"]() };
        const out = pasteNotes(c, topKey, cells[caret.col] ?? origin);
        if (!out.length) return { note: m["grid.nothingToPaste"]() };
        const dropped = droppedCount(out.length, c);
        return {
          line: `sequence note add ${seqId} ${JSON.stringify(out)}`,
          note:
            m["grid.pasted"]({
              n: out.length,
              s: out.length > 1 ? "s" : "",
            }) +
            (dropped ? ` — ${m["grid.pasteDropped"]({ n: dropped })}` : ""),
        };
      },
    }),
    [
      grid,
      caret.col,
      caret.row,
      secondsOfCol,
      onSeek,
      onSetLoop,
      notes,
      seqId,
      rows,
      cells,
      origin,
      prec.beats,
    ],
  );

  // …and the flag the shell's conditional bindings read (see OnGridSelection).
  useEffect(() => {
    if (active) onSelection?.(!!box);
  }, [active, box, onSelection]);

  /** What the grid draws, in ONE pass over the notes: a scan per cell is a hundred thousand comparisons per render. */
  const byCell = useMemo(
    () => notesByCell(notes, origin, span, prec.beats),
    [notes, origin, span, prec.beats],
  );

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
      const done = settledEdits(cur, byCell, cellStartOfKey, prec.beats);
      if (!done.length) return cur;
      const next = new Map(cur);
      for (const k of done) next.delete(k);
      return next;
    });
  }, [byCell, cellStartOfKey, prec.beats]);
  // A different clip's ghosts are not this one's — nor a different PRECISION's: an index counts cells of the step it was made at.
  useEffect(() => {
    setPending(new Map());
  }, [clip.id, prec.beats]);
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
      const onSelUp = () => {
        window.removeEventListener("pointermove", onSelMove);
        window.removeEventListener("pointerup", onSelUp);
      };
      window.addEventListener("pointermove", onSelMove);
      window.addEventListener("pointerup", onSelUp);
      return;
    }
    // Captured for both cases: the release then lands on the PRESSED cell wherever the pointer went.
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    pressY.current = e.clientY;
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
    const from = nudgeOf(hit.time, cellStart, prec.beats);
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
        const landed = nudgedTime(cellStart, prec.beats, to);
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
    if (!began) return;
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
        : `sequence note new ${seqId} ${row.note} ${cellStart} ${Math.min(cellStart + prec.beats, origin + span)}`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-t-2 border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="font-semibold text-primary">
          <Grip className="h-3.5 w-3.5" /> {seqId}
        </span>
        <span className="text-muted-foreground">
          {m["seq.counts"]({ sounds: rack.length, steps: cells.length })}
          {loop && (
            <span className="ml-2 text-violet-400">
              · loop {+loop.win.toFixed(3)}b
              {loop.passes > 1 && ` × ${loop.passes}`}
            </span>
          )}
        </span>
        <span className="text-muted-foreground/70">{m["seq.hint"]()}</span>
        {/* The precision, a closed set so the grid never lands on a musically meaningless step; session state, written nowhere. */}
        <span className="ml-auto flex items-center gap-1">
          {PRECISIONS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPrec(p)}
              aria-pressed={p.label === prec.label}
              title={m["seq.precision"]({ label: p.label })}
              className={cn(
                "rounded px-1.5 py-0.5 tabular-nums hover:bg-accent hover:text-foreground",
                p.label === prec.label
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </span>
        {/* …and the whole pattern again after itself: the one edit here that is about the sequence rather than a pad. */}
        <SeqDoubleButton seqId={seqId} command={command} />
        {modes}
      </div>

      {/* The grid: one row per sound, one column per step, in two columns of the SAME row rhythm so the playhead maps onto music and not the label gutter. */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="flex w-max min-w-full">
          <div className="sticky left-0 z-10 shrink-0 bg-background pr-2">
            {rows.map((row) => (
              <div
                key={row.note}
                className="mb-0.5 flex h-14 items-center justify-end gap-1 font-mono text-[11px]"
              >
                <span
                  className={cn(
                    "font-semibold",
                    row.known ? "text-foreground" : "text-amber-400",
                  )}
                  title={row.known ? undefined : m["seq.offRack"]()}
                >
                  {row.symbol}
                </span>
                <span className="text-muted-foreground/70">
                  {row.known ? noteName(row.note) : `k${row.note}`}
                </span>
              </div>
            ))}
          </div>
          <div className="relative">
            {rows.map((row, rowIndex) => (
              <div key={row.note} className="mb-0.5 flex h-14 gap-0.5">
                {cells.map((cellStart, cellIndex) => {
                  // What the document says, then what a press said before it could — the ghost wins, until the two agree.
                  const key = `${row.note}@${cellIndex}`;
                  const doc = byCell.get(key) ?? null;
                  const ghost = pending.get(key);
                  // A cell painted ON before the document has a note stands in for one AT THE CELL'S START, which is where the command puts it.
                  const base: WebNote | null = ghost
                    ? ghost.on
                      ? (doc ?? {
                          time: cellStart,
                          duration: prec.beats,
                          key: row.note,
                          ...(ghost.vel === undefined
                            ? {}
                            : { vel: ghost.vel }),
                        })
                      : null
                    : doc;
                  // A painted NUDGE moves the note the pad stands for, so the next notch reads where the last one put it.
                  const hit: WebNote | null =
                    base && ghost?.nudge !== undefined
                      ? {
                          ...base,
                          time: nudgedTime(cellStart, prec.beats, ghost.nudge),
                        }
                      : base;
                  // …and what the corner says: hundredths of a step, drawn only when there are any.
                  const nudge = hit
                    ? nudgeOf(hit.time, cellStart, prec.beats)
                    : 0;
                  const onBar =
                    Math.abs(
                      cellStart / barBeats - Math.round(cellStart / barBeats),
                    ) < 1e-6;
                  const onBeat =
                    Math.abs(cellStart - Math.round(cellStart)) < 1e-6;
                  // The velocity the cell DRAWS: what a press said, else what the file states — a drag in flight moves these layers itself.
                  const live = ghost?.vel ?? hit?.vel ?? 1;
                  const lineY = (1 - live) * (CELL_H - 1);
                  const fill = row.known ? "emerald" : "amber";
                  // Where the caret is, and whether the rectangle covers this cell; the caret hides while a rectangle is live.
                  const isCaret =
                    !box && caret.row === rowIndex && caret.col === cellIndex;
                  const selected = !!box && inBox(box, rowIndex, cellIndex);
                  return (
                    <button
                      key={cellStart}
                      type="button"
                      data-cell={cellStart}
                      data-key={key}
                      data-note={row.note}
                      data-row={rowIndex}
                      data-col={cellIndex}
                      onPointerDown={(e) =>
                        onCellDown(e, row, hit, {
                          row: rowIndex,
                          col: cellIndex,
                        })
                      }
                      onPointerMove={onCellMove}
                      onPointerUp={(e) => onCellUp(e, row, hit)}
                      onWheel={(e) => onCellWheel(e, row, hit, cellStart)}
                      onContextMenu={(e) => onCellMenu(e, hit)}
                      title={
                        hit
                          ? m["seq.cellHit"]({
                              symbol: row.symbol,
                              beat: +cellStart.toFixed(3),
                              nudge: nudge ? ` +${nudge}/100` : "",
                              vel: +live.toFixed(2),
                            })
                          : `${row.symbol} · beat ${+cellStart.toFixed(3)}`
                      }
                      className={cn(
                        "relative h-14 w-10 shrink-0 overflow-hidden rounded-[2px] sm:w-12",
                        hit
                          ? "cursor-ns-resize touch-none"
                          : // A bar starts loud, a beat firm, a subdivision quiet — the ruler's
                            // three weights, restated as the empty cells' own shading.
                            onBar
                            ? "bg-muted/50 hover:bg-muted/80"
                            : onBeat
                              ? "bg-muted/30 hover:bg-muted/60"
                              : "bg-muted/15 hover:bg-muted/40",
                        // The caret and the rectangle as the timeline draws them: a wash with an OUTLINE, which costs the cell no width.
                        selected &&
                          "bg-primary/25 outline outline-1 -outline-offset-1 outline-primary",
                        isCaret &&
                          "outline outline-1 -outline-offset-1 outline-primary",
                      )}
                    >
                      {/* A lit cell reads as a LEVEL, the roll's split restated; an unknown row's cells are amber, like their label. */}
                      {hit && (
                        <>
                          <div
                            data-fill="above"
                            className={cn(
                              "pointer-events-none absolute inset-x-0 top-0",
                              fill === "emerald"
                                ? "bg-emerald-500/50"
                                : "bg-amber-500/50",
                            )}
                            style={{ height: lineY }}
                          />
                          <div
                            data-fill="below"
                            className={cn(
                              "pointer-events-none absolute inset-x-0 bottom-0",
                              fill === "emerald"
                                ? "bg-emerald-500"
                                : "bg-amber-500",
                            )}
                            style={{ top: lineY }}
                          />
                          <div
                            data-fill="line"
                            className="pointer-events-none absolute left-1/4 h-px w-1/2 bg-white"
                            style={{ top: lineY }}
                          />
                        </>
                      )}
                      {/* The nudge in hundredths of a step, over the fill: a column of its own would cost a 40px pad a fifth of its width. */}
                      {nudge > 0 && (
                        <span className="pointer-events-none absolute top-0 right-0.5 font-mono text-[9px] text-white/80 leading-none tabular-nums">
                          {nudge}
                        </span>
                      )}
                      {/* The pad's EFFECTS, bottom-left, glyph PLUS number since ×2 against ×4 is the whole of what was chosen (packages/song/docs/padEffects.md). */}
                      {hit && (hit.repeat || hit.skip) && (
                        <span className="pointer-events-none absolute bottom-0 left-0.5 flex gap-0.5 font-mono text-[9px] text-white leading-none tabular-nums">
                          {hit.repeat && (
                            <span title={m["seq.repeated"]({ n: hit.repeat })}>
                              ⁝{hit.repeat}
                            </span>
                          )}
                          {hit.skip && (
                            <span title={m["seq.skipped"]({ n: hit.skip })}>
                              ⌇{hit.skip}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            <StepPlayhead
              tempo={project.tempo}
              clipStart={clip.start}
              placedEnd={clip.length}
              span={span}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The transport line over the grid, held apart so a 20 Hz subscription does not redraw a table of buttons; positioned by TIME fraction. */
function StepPlayhead({
  tempo,
  clipStart,
  placedEnd,
  span,
}: {
  tempo: number;
  clipStart: number;
  placedEnd: number;
  span: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Per animation frame, and translated rather than `left`-ed (docs/playhead.md): the box spans the panel, a percentage translate being of its own width.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const localBeat = (seconds * tempo) / 60 - clipStart;
        const inside =
          span > 0 && localBeat >= 0 && localBeat <= Math.max(placedEnd, span);
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside)
          el.style.transform = `translateX(${((localBeat % span) / span) * 100}%)`;
      },
      [tempo, clipStart, placedEnd, span],
    ),
  );
  return (
    // The outer box does not move and CLIPS: without it the translated inner one would grow a phantom horizontal scrollbar.
    <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-full overflow-hidden">
      <div
        ref={ref}
        className="absolute inset-y-0 left-0 w-full border-white/80 border-l"
        style={{ willChange: "transform", visibility: "hidden" }}
      />
    </div>
  );
}
