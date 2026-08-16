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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clipLoop } from "../clipLoop";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import {
  notesByCell,
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
  const inFlight = useRef(0);
  useEffect(() => {
    setPending((cur) => {
      if (!cur.size) return cur;
      // Nothing left in flight, and a document has just landed: it has the last word, so a
      // ghost that still disagrees was a command that FAILED (a destination taken meanwhile,
      // say) and must not stay on screen. While writes are out, only the settled ones go.
      if (inFlight.current === 0) return new Map();
      const done = settledEdits(cur, byCell);
      if (!done.length) return cur;
      const next = new Map(cur);
      for (const k of done) next.delete(k);
      return next;
    });
  }, [byCell]);
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

  const onCellDown = (e: React.PointerEvent, row: Row, hit: WebNote | null) => {
    e.preventDefault();
    // Captured for both cases: the release then lands on the PRESSED cell wherever the
    // pointer went, which is what lets a short slip still mean this cell.
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    pressY.current = e.clientY;
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
            {rows.map((row) => (
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
                  const hit: WebNote | null = ghost
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
                  return (
                    <button
                      key={cellStart}
                      type="button"
                      data-cell={cellStart}
                      data-key={key}
                      data-note={row.note}
                      onPointerDown={(e) => onCellDown(e, row, hit)}
                      onPointerMove={onCellMove}
                      onPointerUp={(e) => onCellUp(e, row, hit)}
                      title={
                        hit
                          ? `${row.symbol} · beat ${+cellStart.toFixed(3)} · vel ${+live.toFixed(2)} — glisser règle la vélocité, ctrl+glisser déplace la note, cliquer enlève`
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
