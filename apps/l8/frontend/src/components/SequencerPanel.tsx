// SequencerPanel.tsx — a MIDI clip whose track feeds a RACK, edited as a STEP SEQUENCER: one
// row per rack sound — plus one per key the notes use that the rack does not name — a fixed
// grid of cells over the clip's window, a lit cell = "this sound hits here". The precision
// (1/2 … 1/16 notes) is the person's, per panel. A press toggles; a vertical DRAG on a lit
// cell is the roll's velocity gesture, restated for a button. Every commit is one note
// command — one line, one Ctrl+Z — and the grid redraws from the reload it triggers.

import { cn } from "@frediverse/ui/lib/utils";
import type { WebRackSound } from "@studio/graph-model";
import {
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
import {
  type ClipGridHandle,
  colSpan,
  inBox,
  type OnGridSelection,
  selBox,
  songSecondsOfCol,
} from "../gridCaret";
import { useGridCaret } from "../hooks/useGridCaret";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
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

// A cell's pixel height (h-14). The velocity line's geometry needs it as a NUMBER: 0 at the
// bottom edge, 1 at the top, exactly the roll's row geometry at a fixed size.
const CELL_H = 56;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
// How long the wheel must be still before a nudge is written. Long enough that a flick is one
// command rather than twenty, short enough that letting go feels like the end of the gesture.
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
}: {
  project: WebProject;
  clip: WebClip;
  /** The downstream rack's sounds, in symbol order — the rows. See rackFor.ts. */
  rack: WebRackSound[];
  /** The view switch, drawn at the end of the header — the same control the other two views
   *  carry, so leaving the sequencer and coming back are one gesture. See ClipViewModes.tsx. */
  modes?: ReactNode;
  /** Runs a command line through the shell, which journals it — one press, one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  /** Where the shell reaches the caret: `v`, `t` and Shift+L are commands, so they arrive from
   *  the command bar rather than from a key handler here. See ClipView's ClipViewHandle. */
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
}) {
  const notes = clip.notes;
  const seqId = clip.name || clip.id;
  const barBeats = Math.max(1, project.timeSigNumerator || 4);
  // The window the grid divides: the clip's own cage, exactly as the roll's (one pass of a
  // looped clip; the placed extent otherwise). rollFit is not reused because a step grid has no
  // fit question — the window IS the grid, margins would be cells nothing plays.
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
  // The rack's rows first, in its own order — then a row per key the notes use that the rack
  // does not name, high first: a played take must SHOW, not be counted away. Their labels are
  // the pitch, since a pitch is all that is known about them.
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

  /**
   * The caret, and the `v` rectangle over it — the timeline's, on this grid (see gridCaret.ts).
   * The rows and the steps ARE the grid, so nothing has to be invented: a cell is a sound at a
   * step, which is exactly what this panel is a picture of.
   *
   * Keyed on the precision as well as the clip, because a step is a different width at 1/8 than
   * at 1/16 — a caret left at column 12 would be at a different MOMENT, which is not where you
   * put it.
   */
  const grid = useGridCaret({
    active,
    rows: rows.length,
    cols: cells.length,
    resetKey: `${clip.id}@${prec.beats}`,
    onStatus: setStatus,
  });
  const { caret, box } = grid;

  // What the transport is told: a column's own beat of the song, through the placement. The
  // grid's origin cancels — see songBeatOfCol.
  const secondsOfCol = useCallback(
    (col: number) =>
      songSecondsOfCol(col, prec.beats, clip.start, project.tempo),
    [prec.beats, clip.start, project.tempo],
  );

  // What the rectangle is, in words — the timeline says the same thing about its own, and for the
  // same reason: a wash of colour does not say how many steps it covers or what to press next.
  useEffect(() => {
    if (!active || !box) return;
    const steps = box.colHi - box.colLo + 1;
    const lanes = box.rowHi - box.rowLo + 1;
    setStatus?.(
      `selection: ${steps} pas × ${lanes} son${lanes > 1 ? "s" : ""} — ⇧L la boucle · v annule`,
    );
  }, [active, box, setStatus]);

  useImperativeHandle(
    caretRef,
    (): ClipGridHandle => ({
      toggleSelect: grid.toggleSelect,
      // `t`: the caret's step, as a moment in the song.
      seekToCaret: () => onSeek?.(secondsOfCol(caret.col)),
      /**
       * Shift+L: the rectangle becomes the loop region. Its span runs to the FAR edge of the last
       * selected step (`colSpan`'s +1), so a one-cell selection loops that one step rather than
       * nothing — the rule the timeline's loop already follows.
       *
       * With no rectangle it CLEARS, which is what makes one key both set and unset it.
       */
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
      /**
       * `ui copy` — the notes the rectangle holds. A row here is a rack SOUND rather than a
       * pitch, so the corner is taken through the rows' own notes: the sounds are listed in the
       * rack's order, which is not the keyboard's, and a paste has to move by rows the way the
       * eye reads them.
       */
      copy: () => {
        const s = grid.sel;
        if (!s) return null;
        const b = selBox(s);
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
      /** `paste` — one `sequence note add`, landing the rectangle's corner on the caret's cell. */
      pasteLine: (c) => {
        if (c.kind !== "notes")
          return {
            note: "le presse-papier tient des événements, pas des notes",
          };
        const topKey = rows[caret.row]?.note;
        if (topKey === undefined)
          return { note: "aucune ligne sous le curseur" };
        const out = pasteNotes(c, topKey, cells[caret.col] ?? origin);
        if (!out.length)
          return { note: "rien à coller ici — tout tombe hors du clavier" };
        const dropped = droppedCount(out.length, c);
        return {
          line: `sequence note add ${seqId} ${JSON.stringify(out)}`,
          note:
            `${out.length} note${out.length > 1 ? "s" : ""} collée${out.length > 1 ? "s" : ""}` +
            (dropped ? ` — ${dropped} hors clavier, laissée(s)` : ""),
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

  /**
   * What the grid draws, in ONE pass over the notes rather than a scan per cell — sixteen rows
   * of sixty-four cells over a hundred notes was a hundred thousand comparisons per render, and
   * a velocity drag renders on every pointer frame.
   */
  const byCell = useMemo(
    () => notesByCell(notes, origin, span, prec.beats),
    [notes, origin, span, prec.beats],
  );

  /**
   * Presses the document has not caught up with yet.
   *
   * A `sequence note` command costs ~400 ms server-side (it recompiles the project) and the
   * reload lands after that. Waiting for it before lighting the cell is what made editing feel
   * slow — and the panel used to DISABLE the whole grid meanwhile, so everything pressed during
   * that half second was dropped in silence. So a press paints at once and the command is only
   * fired; the ghost is held until the document AGREES, exactly as the timeline holds a clip
   * drag's. See `settledEdits`.
   */
  const [pending, setPending] = useState<ReadonlyMap<string, PadEdit>>(
    new Map(),
  );
  /**
   * A pad key back to its step's beat. The key ends in `@<cellIndex>`, so this is the cells
   * array read the other way round — the one thing a nudge cannot be judged without.
   *
   * Through a ref, and STABLE: `cells` is rebuilt on every render, so a callback closing over it
   * would change identity on every render, and the reconcile below — which has to name it as a
   * dependency — would then run on every render instead of when a document lands.
   */
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
      // Nothing left in flight, and a document has just landed: it has the last word, so a
      // ghost that still disagrees was a command that FAILED (a destination taken meanwhile,
      // say) and must not stay on screen. While writes are out, only the settled ones go.
      if (inFlight.current === 0) return new Map();
      const done = settledEdits(cur, byCell, cellStartOfKey, prec.beats);
      if (!done.length) return cur;
      const next = new Map(cur);
      for (const k of done) next.delete(k);
      return next;
    });
  }, [byCell, cellStartOfKey, prec.beats]);
  // A different clip's ghosts are not this one's — and neither are a different PRECISION's: a
  // key is `<note>@<cellIndex>`, and an index counts cells of the step it was made at, so
  // "36@2" means one place at 1/8 and another at 1/16. The commands already fired still land;
  // the document is what proves them from here.
  useEffect(() => {
    setPending(new Map());
  }, [clip.id, prec.beats]);
  const paint = (key: string, edit: PadEdit) =>
    setPending((cur) => new Map(cur).set(key, edit));

  /**
   * The commands, in ORDER and never blocking. Serialised because each is a read-modify-write of
   * one file — two in flight could lose one — but chained rather than gated, so the grid answers
   * every press instead of dropping the ones that arrive while a write is out.
   */
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

  /**
   * The press on a lit cell, undecided until it travels — the roll's rule, with the roll's 4px
   * slop: a drag sets the VELOCITY (live line, committed on release), a press that never moves
   * toggles the note OFF. An empty cell has only the toggle. The live value is a ref with state
   * only for drawing, for the roll's reason: a command must not fire from inside an updater.
   */
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

  /**
   * Move the pressed cell's three level layers, in place.
   *
   * Deliberately NOT React state: a drag fires on every pointer frame, and a grid of a thousand
   * buttons cannot be reconciled at that rate to move one line three pixels. Same rule the
   * transport line follows — what moves that often should not be laying anything out. The
   * release paints through `pending`, and the render that follows writes these very styles.
   */
  const drawLevel = (cell: Element, vel: number) => {
    const y = (1 - clamp(vel, 0, 1)) * (CELL_H - 1);
    const above = cell.querySelector<HTMLElement>('[data-fill="above"]');
    const below = cell.querySelector<HTMLElement>('[data-fill="below"]');
    const line = cell.querySelector<HTMLElement>('[data-fill="line"]');
    if (above) above.style.height = `${y}px`;
    if (below) below.style.top = `${y}px`;
    if (line) line.style.top = `${y}px`;
  };
  // Whether a press actually STARTED on a cell — a release over one whose press began
  // elsewhere (the header, another pane) must not write a note.
  const pressed = useRef(false);

  const onCellDown = (
    e: React.PointerEvent,
    row: Row,
    hit: WebNote | null,
    at: { row: number; col: number },
  ) => {
    e.preventDefault();
    /**
     * SHIFT: the caret grows into the rectangle, anchored where it already is (or where the
     * rectangle already was) and headed under the pointer — the timeline's shifted press,
     * restated for a grid of buttons. It runs BEFORE the note gestures, so shift-dragging over
     * lit cells selects them instead of rewriting their velocities.
     *
     * The head's cell comes off the DOM the cells already carry (`data-row`/`data-col`) rather
     * than from arithmetic on the pointer: the geometry is the browser's, and a second copy of
     * it would drift the moment a row's height or the gap changed.
     */
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
    // Captured for both cases: the release then lands on the PRESSED cell wherever the
    // pointer went, which is what lets a short slip still mean this cell.
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    pressY.current = e.clientY;
    // A press is also where you are: the caret follows it, which is what makes `v` and `t`
    // mean the cell you just touched. Any live rectangle goes — two cannot both be current.
    grid.placeCaret(at);
    if (!hit) return; // an empty cell has only the toggle — see onCellUp
    vDrag.current = {
      note: row.note,
      time: hit.time,
      vel: hit.vel ?? 1,
      moved: false,
      // Ctrl (or Cmd) at the PRESS decides which gesture this is, and it cannot change
      // mid-drag: what you started doing is what the release commits.
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
  /**
   * --- shift + wheel: NUDGE the pad under the cursor -------------------------------------
   *
   * One notch is a HUNDREDTH of the sequence's own step — 1/16 at 120 bpm is 1.25 ms — so this
   * is the micro-timing control: the grid says which step a hit is on, the nudge says how it
   * sits against it. The value is drawn top-right of the pad, in hundredths, and only when
   * there is one: a grid of zeroes would be noise over the thing it is annotating.
   *
   * Bounded by the pad's own step, 0..99, and that bound is the gesture's rather than a
   * limitation. A note that left its step would be on ANOTHER step — the pad would vanish from
   * under the cursor mid-turn, and the next notch would fall on an empty cell. To place a hit
   * just before a beat, nudge the pad on the step BEFORE it: 95 hundredths of the previous step
   * is five hundredths early, and the pad you are turning stays where your hand is.
   *
   * Shift, because a bare wheel scrolls the grid and this pane can be wider than the pane. React
   * binds `onWheel` on the ELEMENT, where it is not passive, so `preventDefault` holds — the same
   * reasoning the audio clip panel's zoom states.
   */
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
    // Up is later, down is earlier — the wheel's own direction, and the same one the velocity
    // drag reads: away from you is more.
    const to = clamp(from + (e.deltaY < 0 ? 1 : -1), 0, NUDGE_MAX);
    if (to === from) return;
    paint(key, { on: true, vel: hit.vel, nudge: to });

    /**
     * The command waits for the wheel to STOP, unlike every other gesture here.
     *
     * A press is one command and a drag commits once on release, but a wheel is a stream — a
     * flick is twenty notches, and each `sequence note` recompiles the project. So the pad is
     * painted per notch and the write is deferred until the turning settles: one command, one
     * line in the journal, one Ctrl+Z for the gesture a hand actually made.
     *
     * The note is addressed by where it is NOW (`hit.time`, which is the ghost's once one is
     * painted) and moved to where the pad has got to by then, so the twenty notches in between
     * cost nothing and leave nothing to reconcile.
     */
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

    /**
     * A ctrl-drag MOVES the note to the cell it was released over — pad and step both, since
     * the grid is two axes of one thing. The destination comes from the point rather than from
     * the event's target: the press captured the pointer, so every release lands on the cell it
     * STARTED on, whatever is under the cursor.
     *
     * It carries the note's velocity and length across by construction — the writer moves the
     * note rather than rebuilding it (`sequence note move`). Nothing is done when the drop
     * lands outside the grid, on the cell it came from, or on one that already holds a note:
     * (key, start) is how a note is addressed, and two on one pad would be the same note twice.
     */
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
    // A press that never travelled: the toggle. Off at the note's REAL start (a played take's
    // hit lives mid-cell); on for one step, clamped to the window so the last partial cell
    // writes a note that fits it. Painted first — the command is ~400 ms behind.
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
        <span className="font-semibold text-primary">⣿ {seqId}</span>
        <span className="text-muted-foreground">
          {rack.length} sons · {cells.length} pas
          {loop && (
            <span className="ml-2 text-violet-400">
              · loop {+loop.win.toFixed(3)}b
              {loop.passes > 1 && ` × ${loop.passes}`}
            </span>
          )}
        </span>
        <span className="text-muted-foreground/70">
          cliquer pose/enlève · glisser règle la vélocité · ctrl+glisser déplace
          · ⇧molette décale d'un centième de pas
        </span>
        {/* The precision — a closed set, so the grid never lands on a step nothing musical
            means. Session state of this panel, deliberately not written anywhere. */}
        <span className="ml-auto flex items-center gap-1">
          {PRECISIONS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPrec(p)}
              aria-pressed={p.label === prec.label}
              title={`pas de ${p.label}`}
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
        {modes}
      </div>

      {/* The grid: one row per sound, one column per step, the bar boundaries shaded down the
          page. Two columns of the SAME row rhythm — sticky labels, then the cells with the
          playhead over them alone, so the line's time fraction maps onto pixels of music and
          not onto the label gutter. */}
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
                  title={
                    row.known
                      ? undefined
                      : "hors rack — aucun son ne répond à cette note"
                  }
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
                  // What the document says, then what a press said before it could — the ghost
                  // wins, and is dropped the moment the two agree (see `pending`).
                  const key = `${row.note}@${cellIndex}`;
                  const doc = byCell.get(key) ?? null;
                  const ghost = pending.get(key);
                  // A cell painted ON before the document has a note stands in for one AT THE
                  // CELL'S START — which is exactly where `sequence note new` is putting it, so
                  // a velocity drag begun on the ghost addresses the right note once it lands.
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
                  // A painted NUDGE moves the note the pad stands for, so the next notch reads
                  // where the last one put it rather than where the document still says it is.
                  const hit: WebNote | null =
                    base && ghost?.nudge !== undefined
                      ? {
                          ...base,
                          time: nudgedTime(cellStart, prec.beats, ghost.nudge),
                        }
                      : base;
                  // …and what the corner says: hundredths of a step, drawn only when there are
                  // any. Zero is where a pad sits by default, and a grid of zeroes would be
                  // noise over the thing it annotates.
                  const nudge = hit
                    ? nudgeOf(hit.time, cellStart, prec.beats)
                    : 0;
                  const onBar =
                    Math.abs(
                      cellStart / barBeats - Math.round(cellStart / barBeats),
                    ) < 1e-6;
                  const onBeat =
                    Math.abs(cellStart - Math.round(cellStart)) < 1e-6;
                  // The velocity the cell DRAWS: what a press said, else what the file states.
                  // A drag in flight moves these layers itself — see `drawLevel`.
                  const live = ghost?.vel ?? hit?.vel ?? 1;
                  const lineY = (1 - live) * (CELL_H - 1);
                  const fill = row.known ? "emerald" : "amber";
                  // Where the caret is, and whether the rectangle covers this cell. The caret is
                  // hidden while a rectangle is live: the rectangle IS the caret then, with two
                  // ends — the timeline's rule, so the two panes read the same.
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
                      title={
                        hit
                          ? `${row.symbol} · beat ${+cellStart.toFixed(3)}${nudge ? ` +${nudge}/100` : ""} · vel ${+live.toFixed(2)} — glisser règle la vélocité, ⇧molette décale, ctrl+glisser déplace, cliquer enlève`
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
                        // The caret and the rectangle, drawn as the timeline draws them: a
                        // primary wash with an outline. An OUTLINE rather than a border, so the
                        // mark costs the cell no width and the grid does not shift under it.
                        selected &&
                          "bg-primary/25 outline outline-1 -outline-offset-1 outline-primary",
                        isCaret &&
                          "outline outline-1 -outline-offset-1 outline-primary",
                      )}
                    >
                      {/* A lit cell reads as a LEVEL, the roll's split restated: above the
                          velocity a little transparent, below it solid, the line itself white.
                          An unknown row's cells are amber, like their label. */}
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
                      {/* The nudge, in hundredths of a step, in the corner the level bars leave
                          free. Over the fill rather than beside it: the pad is 40px wide and a
                          column of its own would have cost the grid a fifth of its width. */}
                      {nudge > 0 && (
                        <span className="pointer-events-none absolute top-0 right-0.5 font-mono text-[9px] text-white/80 leading-none tabular-nums">
                          {nudge}
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

/**
 * The transport line over the grid, and the only part of the panel that knows the transport —
 * held apart for the reason the roll's is: a 20 Hz subscription must not redraw a table of
 * buttons. Positioned by TIME fraction of the window, folded across the passes of a looped
 * clip exactly as the roll's playhead folds.
 */
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
  // Per animation frame, and off `left` onto a transform while we are here: `left` is LAYOUT,
  // and this used to relayout the grid twenty times a second. The line is the element's left
  // EDGE — the box spans the panel and gets translated, because a percentage translate is a
  // percentage of the element's own width, which is the panel's only when it spans it. Same
  // trick the minimap's playhead uses, and for the same reason. See docs/playhead.md.
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
    // The outer box does not move and CLIPS. Without it the inner one, translated up to a full
    // width right, would extend the scrollable overflow of the panel's `overflow-auto` ancestor
    // and grow a phantom horizontal scrollbar for as long as the transport rolled. The minimap
    // uses the same full-width translate with no wrapper because nothing scrolls around it.
    <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-full overflow-hidden">
      <div
        ref={ref}
        className="absolute inset-y-0 left-0 w-full border-white/80 border-l"
        style={{ willChange: "transform", visibility: "hidden" }}
      />
    </div>
  );
}
