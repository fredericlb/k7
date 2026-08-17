// PianoRoll.tsx — a piano-roll view/editor of a MIDI clip. A clip that states a window
// (`from`/`to`) is FRAMED on it with a margin either side, the canvas still spanning the whole
// sequence: what is outside sounds in no pass, so it is drawn dimmed and cannot be edited
// (rollFit.ts, docs/clipEditors.md). Left-click-drag draws a note (press = pitch + start,
// release = end) via `sequence note new`; a wheel zooms time and a middle-drag pans.
// Drawn by the Editor bottom panel and, when a clip is clicked, where the graph is (ClipView).

import { cn } from "@frediverse/ui/lib/utils";
import { useHZoom, usePanScroll } from "@studio/ui-timeline/panZoom";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { copyNotes, droppedCount, pasteNotes } from "../clipboard";
import { clipLoop } from "../clipLoop";
import {
  type ClipGridHandle,
  colSpan,
  type OnGridSelection,
  selBox,
  songSecondsOfCol,
} from "../gridCaret";
import { useGridCaret } from "../hooks/useGridCaret";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { m } from "../paraglide/messages.js";
import { rollFit } from "../rollFit";
import { freeSnap, snapTo } from "../snap";
import type { WebClip, WebProject } from "../types";
import { ArrangementRuler, Grid, RulerTicks, rulerScale } from "./Ruler";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pc = (k: number) => ((k % 12) + 12) % 12;
// Exported for the step sequencer's row labels — one spelling of a key, wherever it is read.
export const noteName = (k: number) =>
  `${NAMES[pc(k)]}${Math.floor(k / 12) - 1}`; // MIDI 60 => C4
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(pc(k));

const N_NOTES = 128; // every possible MIDI note (0..127)
const PX_PER_BEAT = 24; // fallback beat width for the first, unmeasured frame only
const GUTTER = 44; // note-name column, px
// The shortest a stretch may leave a note. A 64th at any tempo — short enough to be a real
// choice, long enough that a note dragged to nothing does not vanish from the roll it lives on.
const MIN_NOTE_BEATS = 1 / 16;
const RULER_H = 18; // bar/beat ruler height, px
const KEYS = Array.from({ length: N_NOTES }, (_, i) => 127 - i); // high → low, top → bottom
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function PianoRoll({
  project,
  clip,
  modes,
  onClose,
  caretRef,
  active = false,
  setStatus,
  onSelection,
  onSetLoop,
  onSeek,
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
}: {
  project: WebProject;
  clip: WebClip;
  /** The clip pane's view switch, drawn at the end of the header. Absent for the hosts that
   *  offer no other view of these notes — the editor's own preview. See ClipViewModes.tsx. */
  modes?: ReactNode;
  /** Absent when the frame around it owns the closing — see GraphSlotPane. */
  onClose?: () => void;
  /** Where the shell reaches the caret: `v`, `t` and Shift+L are commands, so they arrive from
   *  the command bar rather than from a key handler here. See ClipView's ClipViewHandle. */
  caretRef?: RefObject<ClipGridHandle | null>;
  /** Whether this pane owns the keys — the arrows must not move two carets at once. The editor's
   *  own preview passes nothing and gets no caret, which is right: it is a preview. */
  active?: boolean;
  setStatus?: (s: string) => void;
  /** Whether a rectangle is live — pushed up, since a condition cannot read a ref. */
  onSelection?: OnGridSelection;
  /** Set or clear the transport's loop region, in SONG seconds — Shift+L on the rectangle. */
  onSetLoop?: (fromSec: number, toSec: number, on: boolean) => void;
  /** Seek the transport, in SONG seconds — what a click on the arrangement ruler does. */
  onSeek?: (seconds: number) => void;
  // Draw a note via `sequence note new`; absent, the roll is read-only (no known sequence to write to).
  onCreateNote?: (key: number, startBeat: number, endBeat: number) => void;
  /**
   * Commit a note's velocity via `sequence note velocity` — 0..1, the units the file states.
   *
   * Absent alongside `onCreateNote` for the same reason: there is no sequence to write to. The
   * line is still DRAWN then, because what a note is worth is worth reading either way.
   */
  onSetVelocity?: (key: number, startBeat: number, vel: number) => void;
  /**
   * Commit a note's new time range via `sequence note timerange` — where it starts NOW, then
   * where it should start and end. Beats, the units the file states.
   *
   * Absent ⇒ notes cannot be moved or stretched, and the body's drag is velocity alone. The same
   * arrangement `onSetVelocity` has: a host with nothing to write to passes nothing.
   */
  onSetNoteRange?: (
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void;
}) {
  const notes = clip.notes;
  // The sequence a note command names — the same rule every caller of `sequence note …` uses.
  const seqId = clip.name || clip.id;
  const barBeats = Math.max(1, project.timeSigNumerator || 4);
  // The window that repeats, on this roll's own beat axis — null for a clip that states no loop.
  const loop = clipLoop(clip);

  const bodyRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setPane({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Wheel zooms the time axis; middle-drag pans (both axes). Bound once the body mounts.
  const [zoomX, setZoomX] = useHZoom(bodyRef, { gutter: GUTTER });
  usePanScroll(bodyRef);

  // A DIFFERENT clip opens at fit. The zoom multiplier belongs to the one you were looking at and
  // nothing else let go of it, so a sequence opened after a zoomed one inherited its scale — which
  // is the other half of "it does not open on its content".
  useEffect(() => {
    setZoomX(1);
  }, [clip.id, setZoomX]);

  // What the view opens on, both axes — see rollFit.ts, which is where the arithmetic is tested.
  // `origin` is the beat at the canvas's left edge: the window's `from`, 0 without one.
  const fit = rollFit(notes, clip.length, barBeats, loop);
  const { placedEnd, canvasBeats, origin } = fit;
  const fitHiK = fit.hiKey;
  const fitBeatLo = fit.loBeat;

  // Everything the canvas spans is drawn. A note over an edge is kept and CUT there — the lane
  // clips it — so material half-in still reads as present.
  const visNotes = notes.filter(
    (n) => n.time < origin + canvasBeats && n.time + n.duration > origin,
  );
  /**
   * The window THIS EVENT plays, and the one question every edit here asks.
   *
   * The same split the audio clip panel draws: the canvas is everywhere the wheel may roam, `act`
   * is the slice being worked on. A note outside it does not sound — the engine plays the window —
   * so it is drawn dimmed, as context, and refused as a target. Null for a clip that states no
   * window, where the whole sequence IS the event.
   */
  const act = loop ? { from: loop.from, to: loop.to } : null;
  const inAct = (beat: number) =>
    !act || (beat >= act.from - 1e-6 && beat <= act.to + 1e-6);
  // A note belongs to the event when it SOUNDS in it — the same overlap test the compiler uses,
  // not "starts inside", or a note held across the window's start would read as somebody else's.
  const notePlays = (n: { time: number; duration: number }) =>
    !act || (n.time < act.to - 1e-6 && n.time + n.duration > act.from + 1e-6);

  // A PLACED clip stacks the ARRANGEMENT's ruler over its own: the roll is a magnified piece of
  // the song, and its header should say where in the song you are looking. A sequence FILE has
  // no placement (length 0), so there is nothing global to point at.
  const placed = clip.length > 0;
  const rulersH = RULER_H * (placed ? 2 : 1);

  const availW = Math.max(0, pane.w - GUTTER);
  const availH = Math.max(0, pane.h - rulersH);
  // Base scales: the framed rows fill the height, the framed beat span fills the width — then
  // zoomX stretches the time axis past fit.
  const rowH = availH > 0 ? availH / fit.rows : 12;
  const ppb0 = availW > 0 ? availW / fit.beats : PX_PER_BEAT;
  const ppb = ppb0 * zoomX;
  const laneW = canvasBeats * ppb;
  const gridH = N_NOTES * rowH;
  const keyTop = (k: number) => (127 - k) * rowH;
  const showLabels = rowH >= 9; // only label octave Cs when a row is tall enough

  // Frame the fit once measured, and again for a different clip. Adding notes keeps clip.id, so the view stays.
  const framedFor = useRef<string>("");
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || availH <= 0) return;
    if (framedFor.current === clip.id) return;
    // Wait for the reset above to land: on the commit that changed `clip.id`, `ppb` still carries
    // the previous clip's multiplier, and scrolling by it would land somewhere else entirely.
    if (zoomX !== 1) return;
    framedFor.current = clip.id;
    el.scrollTop = (127 - fitHiK) * rowH; // top of the fit pitch range
    el.scrollLeft = (fitBeatLo - origin) * ppb; // …and the left edge of the fitted span
  }, [clip.id, availH, rowH, fitHiK, fitBeatLo, origin, ppb, zoomX]);

  /**
   * The file's own ruler and the grid under it, on the SHARED ladder — `rulerScale` picks the
   * unit from the current `ppb` exactly as the timeline's does, so zooming in subdivides (bar →
   * beat → half → sixteenth…) and zooming out thins the numbers rather than smearing them.
   *
   * It used to be two hand-rolled loops here: bars every `barBeats`, beats every 1, whatever the
   * zoom. So the roll had a fixed ruler under a zoomable canvas — no lines at all between beats
   * however far in you went, and a wall of unreadable numbers on the way out — and the LANES
   * drew bar lines only, which left the material below the ruler without the ruler's own grid.
   *
   * The beats are ABSOLUTE — the file's own numbering, `origin` included — so a window opening
   * at bar 3 says 3 rather than renumbering itself from 1. That is what the shared ladder gives
   * for free: it counts from the coordinate's origin, not from the view's left edge.
   */
  const gridEnd = origin + canvasBeats;
  const bps = Math.max(1e-6, project.tempo / 60);
  const {
    unit: gridUnit,
    secStep: gridSecStep,
    barStride: gridStride,
  } = rulerScale("bars", ppb, barBeats, bps, gridEnd);

  /**
   * The caret, and the `v` rectangle over it — the timeline's, on the roll's own grid
   * (gridCaret.ts). A row is a PITCH, top-down like the keys, and a column is one step of the
   * ruler's current unit, so the caret walks exactly the lines that are drawn.
   *
   * That the column follows the ZOOM is the point rather than a side effect: the ladder is the
   * resolution control everywhere else in this app (`packages/ui-waveform/docs/ticks.md`), so a
   * finer caret is reached by opening the view, not by a second setting nobody would find.
   */
  const gridCols = Math.max(1, Math.ceil(canvasBeats / gridUnit));
  const grid = useGridCaret({
    active,
    rows: N_NOTES,
    cols: gridCols,
    // The unit is in the key: a caret left at column 12 is a different MOMENT once the zoom
    // halves the step, and that is not where it was put.
    resetKey: `${clip.id}@${gridUnit}`,
    onStatus: setStatus,
  });
  const { caret, box } = grid;
  // Grid coordinates ⇄ the roll's own: a row is 127 − key, a column is a step off the origin.
  const beatOfCol = useCallback(
    (col: number) => origin + col * gridUnit,
    [origin, gridUnit],
  );
  const colOfBeat = useCallback(
    (beat: number) => Math.floor((beat - origin) / gridUnit + 1e-9),
    [origin, gridUnit],
  );

  useImperativeHandle(
    caretRef,
    (): ClipGridHandle => ({
      toggleSelect: grid.toggleSelect,
      // `t`: the caret's step, as a moment in the SONG — through the placement, so it agrees
      // with the arrangement ruler stacked above it.
      seekToCaret: () =>
        onSeek?.(
          songSecondsOfCol(caret.col, gridUnit, clip.start, project.tempo),
        ),
      /**
       * Shift+L: the rectangle becomes the loop region, running to the FAR edge of its last
       * column so a one-cell selection loops that step rather than nothing. With no rectangle it
       * CLEARS — one key that both sets and unsets, as on the timeline.
       */
      toggleLoop: () => {
        const s = grid.sel;
        if (!s) {
          onSetLoop?.(0, 0, false);
          return;
        }
        const { from, to } = colSpan(s);
        const sec = (c: number) =>
          songSecondsOfCol(c, gridUnit, clip.start, project.tempo);
        onSetLoop?.(sec(from), sec(to), true);
        grid.clearSelect();
      },
      /**
       * `ui copy` — the notes the rectangle holds, in the rectangle's own coordinates. A row is a
       * pitch here, so the corner is its TOP key and its left beat; `clipboard.ts` does the rest.
       */
      copy: () => {
        const s = grid.sel;
        if (!s) return null;
        const b = selBox(s);
        return copyNotes(
          notes,
          seqId,
          127 - b.rowHi,
          127 - b.rowLo,
          beatOfCol(b.colLo),
          beatOfCol(b.colHi + 1),
        );
      },
      /**
       * `paste` — one `sequence note add`, so a paste of twelve notes is one journal entry and
       * one Ctrl+Z. It lands relative to the CARET: the rectangle's top-left goes under it, which
       * is what makes a copied bar paste a bar later, or a chord paste a fourth up.
       */
      pasteLine: (c) => {
        if (c.kind !== "notes")
          return {
            note: "le presse-papier tient des événements, pas des notes",
          };
        const out = pasteNotes(c, 127 - caret.row, beatOfCol(caret.col));
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
      gridUnit,
      clip.start,
      project.tempo,
      onSeek,
      onSetLoop,
      notes,
      seqId,
      beatOfCol,
    ],
  );

  // …and the flag the shell's conditional bindings read (see OnGridSelection).
  useEffect(() => {
    if (active) onSelection?.(!!box);
  }, [active, box, onSelection]);

  // What the rectangle is, in words. Pitches rather than rows: on a roll a row IS a note name,
  // and "13 rows" says nothing you can act on.
  useEffect(() => {
    if (!active || !box) return;
    const steps = box.colHi - box.colLo + 1;
    setStatus?.(
      `selection: ${steps} × ${gridUnit >= 1 ? `${gridUnit}b` : `1/${Math.round(1 / gridUnit)}`} · ${noteName(127 - box.rowHi)}–${noteName(127 - box.rowLo)} — ⇧L la boucle · v annule`,
    );
  }, [active, box, gridUnit, setStatus]);

  // --- left-click-drag to draw a note ----------------------------------------------
  // A live draft while dragging: pitch fixed at the press row, time from press to cursor.
  const [draft, setDraft] = useState<{
    k: number;
    t0: number;
    t1: number;
  } | null>(null);
  const drag = useRef<{ k: number; t0: number } | null>(null);

  /**
   * The step a gesture moves in: the grid the roll is drawing, or none while Ctrl is held.
   *
   * The roll used to be free at every zoom, which made it the odd one out — the ruler draws
   * lines, the caret walks them, the timeline's drags land on them, and only a note ignored
   * them. `gridUnit` is the ladder's answer for the current zoom, so a finer position is reached
   * by opening the view, exactly as it is for the caret (`packages/ui-waveform/docs/ticks.md`).
   * Ctrl is what gets the old behaviour back for one gesture.
   */
  const stepAt = (e: PointerEvent | React.PointerEvent): number =>
    freeSnap(e) ? 0 : gridUnit;

  const atEvent = (e: PointerEvent | React.PointerEvent) => {
    const r = laneRef.current!.getBoundingClientRect();
    // Lane x → an ABSOLUTE beat: the lane's left edge is the origin, and a windowed clip cannot
    // be pointed outside its own window.
    const beat = clamp(
      origin + (e.clientX - r.left) / ppb,
      origin,
      origin + canvasBeats,
    );
    const key = clamp(127 - Math.floor((e.clientY - r.top) / rowH), 0, 127);
    return { beat, key };
  };

  /** Where a pointer is, as a GRID cell — the caret's coordinates rather than the lane's. */
  const cellAtEvent = (e: PointerEvent | React.PointerEvent) => {
    const { beat, key } = atEvent(e);
    return { row: 127 - key, col: colOfBeat(beat) };
  };

  /**
   * The span a draw gesture covers, in beats: the CELLS it was dragged across.
   *
   * Cells and not lines, and that is the whole of it: the same press places the caret, which
   * belongs to the cell you pointed INSIDE. A note landing on the nearest line instead would sit
   * one cell away from the caret half the time — the two would disagree about where you clicked.
   *
   * So the start is the pressed cell's own beat, and the end is the FAR edge of the last one, the
   * way `colSpan` reads the rectangle: drag across three cells and you get three cells of note.
   * A press that never leaves its cell returns a zero-length span, which is the caller's cue to
   * let the command choose the length — the behaviour a plain click has always had.
   *
   * Ctrl (`step: 0`) gives back the raw beats, which is what the roll did at every zoom before.
   */
  const drawSpan = (
    a: number,
    b: number,
    step: number,
  ): { from: number; to: number } => {
    if (step <= 0) return { from: Math.min(a, b), to: Math.max(a, b) };
    const lo = Math.min(colOfBeat(a), colOfBeat(b));
    const hi = Math.max(colOfBeat(a), colOfBeat(b));
    return {
      from: beatOfCol(lo),
      to: hi > lo ? beatOfCol(hi) + step : beatOfCol(lo),
    };
  };

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // left only; middle pans
    /**
     * SHIFT: the caret grows into the rectangle — anchored where it is (or where the rectangle
     * already was), headed under the pointer, dragged across pitches and steps. The timeline's
     * shifted press, and it runs before the draw-a-note branch so shift never draws.
     *
     * It is also why this handler no longer returns early when `onCreateNote` is absent: a
     * read-only roll still has a caret, and a selection is not a write.
     */
    if (e.shiftKey) {
      e.preventDefault();
      const feed = grid.beginDrag(cellAtEvent(e));
      const move = (ev: PointerEvent) => feed(cellAtEvent(ev));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    // A press is where you are: the caret follows it, so `v`, `t` and ⇧L mean the cell you
    // just pointed at. Before the draw, and whether or not the roll can write.
    grid.placeCaret(cellAtEvent(e));
    if (!onCreateNote) return;
    e.preventDefault();
    // The RAW beat is what is remembered; the grid is applied where the span is read, so Ctrl
    // pressed or released mid-drag changes the whole answer rather than half of it.
    const { beat, key } = atEvent(e);
    // Outside the event's window a new note would not sound: the engine plays the window, so it
    // would be a note you drew, saw, and never heard. Refused rather than clamped — a note
    // appearing at the edge instead of under the pointer is a note nobody drew there. The caret
    // still moved, because looking is not writing.
    if (!inAct(beat)) return;
    drag.current = { k: key, t0: beat };
    setDraft({ k: key, t0: beat, t1: beat });
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const { from, to } = drawSpan(d.t0, atEvent(ev).beat, stepAt(ev));
      setDraft({ k: d.k, t0: from, t1: to });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      setDraft(null);
      if (!d) return;
      const { from, to } = drawSpan(d.t0, atEvent(ev).beat, stepAt(ev));
      // A press that never left its cell leaves the length to the command's default.
      onCreateNote(d.k, from, to - from > 0.01 ? to : from);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * --- drag a note's VELOCITY -------------------------------------------------------
   *
   * The WHITE LINE is the handle — the mark that says what the note is worth is the thing you take
   * hold of — and it follows the pointer inside the note: 0 at the bottom edge, 1 at the top, which
   * is the geometry velocity is read with everywhere. That does mean a press on a note no longer
   * starts drawing one over it — no loss, since two notes cannot share a key and a start anyway.
   *
   * It used to be the note's whole box, with the DIRECTION of the first movement deciding between
   * velocity and a move. Two gestures sharing one surface meant neither could be started
   * deliberately: a move that began with a little vertical drift set a velocity instead, and the
   * only way to find out was to look at what had changed. Now every grip on a note is a place —
   * the line sets, the right edge stretches, the body moves — which is the rule this app already
   * follows on the waveform's slice handles and the timeline's events.
   *
   * Pointer CAPTURE, as the waveform's slice handles take: every move and the release land on this
   * element, so a fast drag off the note does not lose the gesture. A press that never MOVES
   * commits nothing — a stray click on a note should not silently rewrite what it is worth.
   */
  interface VDrag {
    key: number;
    time: number;
    vel: number;
    moved: boolean;
  }

  /**
   * --- drag a note's TIME RANGE ------------------------------------------------------
   *
   * Four grips on one note, and each is a PLACE rather than a direction:
   *
   * - the white line, within `VEL_PX` of it → its velocity (above);
   * - within `EDGE_PX` of EITHER edge → stretch that end, the other staying where it is. Both
   *   edges are handles on the timeline's events and on the waveform's slices, so both are here;
   * - anywhere else on the body → move.
   *
   * The RIGHT edge is tested first, and that decides a note narrower than two grips: its two zones
   * overlap and one of them has to win. The timeline settles the same overlap the same way — its
   * handles are DOM siblings and the right one paints last — so a narrow thing stretches from its
   * end in both panes rather than one each.
   *
   * A note with nothing to move it (`onSetNoteRange` absent) keeps its whole box as the velocity
   * handle: there is no second gesture to tell it apart from, and a 10-pixel target for the only
   * thing that surface can do would be a needlessly small one.
   *
   * Nothing is written until release, and a press that never travels writes nothing at all — a
   * stray click on a note must not rewrite where it is or what it is worth.
   */
  const EDGE_PX = 6;
  /** How far either side of the white line still counts as holding it. A line is one pixel and
   *  nobody can hit one; the same reasoning sizes the waveform's 12px slice grips. */
  const VEL_PX = 5;
  interface TDrag {
    key: number;
    time: number; // where it starts NOW — how the command addresses it
    dur: number;
    // Which end is in hand, or the whole note. The timeline's own vocabulary for the same
    // gesture (`edge: "start" | "end"`), so the two panes cannot come to mean different things.
    mode: "move" | "start" | "end";
    dBeats: number; // how far it has travelled, in beats
  }
  const [tDraw, setTDraw] = useState<TDrag | null>(null);
  const tDrag = useRef<TDrag | null>(null);
  // Which gesture this press became, once it has travelled far enough to say. The ref is the live
  // one for the same reason the velocity drag's is: a command fired from a state updater runs
  // twice under StrictMode.
  const gesture = useRef<"vel" | "time" | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  // The ref is the LIVE one and the state is only what to draw. The commit reads the ref, because
  // firing a command from inside a state updater would run it twice under StrictMode's double
  // invocation — a velocity written, then written again.
  const [vDraw, setVDraw] = useState<VDrag | null>(null);
  const vDrag = useRef<VDrag | null>(null);

  const velAt = (clientY: number, top: number): number => {
    const el = laneRef.current;
    if (!el || rowH <= 1) return 1;
    // Where the pointer sits inside the note's row, bottom-up.
    const y = clientY - el.getBoundingClientRect().top - top;
    return clamp(1 - y / Math.max(1, rowH - 1), 0, 1);
  };

  /**
   * A press on a note, and `grip` says WHICH of its four it landed on.
   *
   * Named by the element that took the press rather than hit-tested from its coordinates: each
   * grip is its own box now — the line, the two edges — so the geometry that decides is the
   * browser's own, and there is no second copy of it here to disagree with what the cursor
   * showed. Absent ⇒ the body, which is the note itself.
   */
  const onNotePointerDown = (
    e: React.PointerEvent,
    n: { key: number; time: number; duration: number; vel?: number },
    grip?: "line" | "start" | "end",
  ) => {
    if (e.button !== 0 || (!onSetVelocity && !onSetNoteRange)) return;
    e.preventDefault();
    e.stopPropagation(); // not a new note: this press belongs to the one already here
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    // Claimed on the PRESS: a grip is a place, not a direction, so none of them waits to see
    // which way the hand goes.
    const t: TDrag = {
      key: n.key,
      time: n.time,
      dur: n.duration,
      mode: grip === "start" || grip === "end" ? grip : "move",
      dBeats: 0,
    };
    tDrag.current = t;
    const v = { key: n.key, time: n.time, vel: n.vel ?? 1, moved: false };
    vDrag.current = v;
    // The line sets, an edge stretches, the body moves — and a note with nowhere to move to
    // keeps its body as the velocity handle rather than as a surface that does nothing.
    gesture.current =
      grip === "line" && onSetVelocity
        ? "vel"
        : onSetNoteRange
          ? "time"
          : onSetVelocity
            ? "vel"
            : null;
    if (gesture.current === "time") setTDraw(t);
  };

  const onNotePointerMove = (e: React.PointerEvent, top: number) => {
    if (!gesture.current) return;
    const from = pressAt.current;
    if (gesture.current === "vel") {
      const d = vDrag.current;
      if (!d) return;
      // A press that has not travelled is a CLICK on the line, and a click must write nothing —
      // 4px, the same threshold the waveform's pins use to tell one from a drag. Once it has
      // moved the line follows continuously, so the note reads live under the hand.
      if (
        !d.moved &&
        from &&
        Math.abs(e.clientX - from.x) < 4 &&
        Math.abs(e.clientY - from.y) < 4
      )
        return;
      const next = { ...d, vel: velAt(e.clientY, top), moved: true };
      vDrag.current = next;
      setVDraw(next);
      return;
    }
    const d = tDrag.current;
    if (!d || !from) return;
    // The OFFSET snaps, not the resulting position — the timeline's rule, and it means a note
    // played in by hand at 2.43 keeps that phase when you move it a beat. Ctrl frees it, live.
    const next = {
      ...d,
      dBeats: snapTo((e.clientX - from.x) / Math.max(1, ppb), stepAt(e)),
    };
    tDrag.current = next;
    setTDraw(next);
  };

  /**
   * Commit whichever gesture this was.
   *
   * A move slides both ends and keeps the length; an edge moves that end and leaves the other
   * where it is. All three go through ONE command, because on the roll they are one gesture with
   * three grips — see `sequence note timerange`.
   *
   * An edge may not cross the other, which is the timeline's rule and the same arithmetic: the
   * floor is `MIN_NOTE_BEATS`, short enough to be a real choice and long enough that a note left
   * behind still sounds. Measured from where the note WAS when grabbed, never from where it is
   * now — `dBeats` is an absolute offset from the grab point.
   *
   * A move is clamped at zero rather than refused: dragging a note off the front of the sequence
   * means "to the beginning", and a gesture that silently did nothing would read as a dead roll.
   */
  /** Where a drag has taken the note, whichever grip it is on. One answer, read by the PREVIEW
   *  and by the commit — two copies of it would be a ghost that lands somewhere else. */
  const tSpan = (t: TDrag): { start: number; end: number } => {
    if (t.mode === "move") {
      const start = Math.max(0, t.time + t.dBeats);
      return { start, end: start + t.dur };
    }
    const end = t.time + t.dur;
    return t.mode === "start"
      ? {
          start: Math.max(0, Math.min(end - MIN_NOTE_BEATS, t.time + t.dBeats)),
          end,
        }
      : {
          start: t.time,
          end: Math.max(t.time + MIN_NOTE_BEATS, end + t.dBeats),
        };
  };

  const endVDrag = () => {
    const g = gesture.current;
    const v = vDrag.current;
    const t = tDrag.current;
    gesture.current = null;
    vDrag.current = null;
    tDrag.current = null;
    pressAt.current = null;
    setVDraw(null);
    setTDraw(null);
    if (g === "vel" && v?.moved) onSetVelocity?.(v.key, v.time, v.vel);
    if (g === "time" && t && Math.abs(t.dBeats) > 1e-6) {
      const { start, end } = tSpan(t);
      onSetNoteRange?.(t.key, t.time, start, end);
    }
  };

  const draftBox = draft
    ? {
        left: (Math.min(draft.t0, draft.t1) - origin) * ppb,
        width: Math.max(3, Math.abs(draft.t1 - draft.t0) * ppb),
        top: keyTop(draft.k),
      }
    : null;

  return (
    // min-w-0, as in the timeline: the fixed-width grid must not become this flex child's minimum.
    <div className="flex h-full min-h-0 min-w-0 flex-col border-t-2 border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="font-semibold text-primary">
          🎹 {clip.name || clip.id}
        </span>
        <span className="text-muted-foreground">
          {visNotes.length} notes
          {/* What the cage hides, counted — so a windowed file whose notes sit before its `from`
              reads as windowed rather than as data lost. */}
          {notes.length > visNotes.length &&
            ` (+${notes.length - visNotes.length} hors fenêtre)`}{" "}
          · {Math.round(placedEnd)} beats
          {/* What the marks in the grid add up to, said in words: a clip that is ten passes of
              eight beats is not a 80-beat pattern, and the pane is 80 beats wide either way. */}
          {loop && (
            <span className="ml-2 text-violet-400">
              · loop {+loop.win.toFixed(3)}b
              {loop.passes > 1 && ` × ${loop.passes}`}
            </span>
          )}
          {onCreateNote && (
            <span className="ml-2 text-muted-foreground/70">
              · drag to draw · ctrl: hors grille · pinch to zoom · middle-drag
              pan
            </span>
          )}
        </span>
        {modes && <span className="ml-auto">{modes}</span>}
        {onClose && (
          <button
            onClick={onClose}
            title={m["editor.closeHint"]()}
            className={cn(
              "rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
              !modes && "ml-auto",
            )}
          >
            close ✕
          </button>
        )}
      </div>

      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative font-mono"
          style={{ width: GUTTER + laneW, height: rulersH + gridH }}
        >
          {/* The rulers, stacked and sticky as one: the SONG's positions on top (the shared
              arrangement ruler — the same ticks the timeline draws, offset to the placement),
              the file's own bars + beats below. */}
          <div className="sticky top-0 z-20 bg-background text-[10px] text-muted-foreground">
            {placed && (
              <div className="flex" style={{ height: RULER_H }}>
                <div
                  className="sticky left-0 z-10 shrink-0 border-b border-r border-border bg-background"
                  style={{ width: GUTTER }}
                />
                <div
                  className="relative border-b border-border/50"
                  style={{ width: laneW }}
                >
                  <ArrangementRuler
                    startBeat={clip.start}
                    beats={canvasBeats}
                    ppb={ppb}
                    barBeats={barBeats}
                    tempo={project.tempo}
                    height={RULER_H}
                    onSeek={onSeek}
                  />
                </div>
              </div>
            )}
            {/* bars + beats ruler — the FILE's own numbering, window origin included, on the
                same ladder the arrangement ruler above it and the timeline both draw. */}
            <div className="flex" style={{ height: RULER_H }}>
              <div
                className="sticky left-0 z-10 shrink-0 border-b border-r border-border bg-background"
                style={{ width: GUTTER }}
              />
              <div
                className="relative overflow-hidden border-b border-border"
                style={{ width: laneW }}
              >
                <RulerTicks
                  mode="bars"
                  beatLo={origin}
                  lastBeat={gridEnd}
                  unit={gridUnit}
                  barBeats={barBeats}
                  bps={bps}
                  secStep={gridSecStep}
                  scroller={bodyRef}
                  ppb={ppb}
                  barStride={gridStride}
                />
              </div>
            </div>
          </div>

          {/* piano gutter + note grid */}
          <div className="flex" style={{ height: gridH }}>
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
              style={{ width: GUTTER }}
            >
              {KEYS.map((k) => (
                <div
                  key={k}
                  className={`flex items-center justify-end pr-1 text-[9px] text-muted-foreground ${isBlack(k) ? "bg-muted/50" : ""}`}
                  style={{ height: rowH, lineHeight: `${rowH}px` }}
                >
                  {showLabels && pc(k) === 0 ? (
                    <>
                      {noteName(k)} <span className="opacity-50">{k}</span>
                    </>
                  ) : (
                    ""
                  )}
                </div>
              ))}
            </div>
            <div
              ref={laneRef}
              // overflow-hidden is the cage's edge: a note crossing the window's `from` or `to`
              // is drawn at its true beats and cut where the window ends.
              className={`relative overflow-hidden ${onCreateNote ? "cursor-crosshair" : ""}`}
              style={{ width: laneW }}
              onPointerDown={onLanePointerDown}
            >
              {KEYS.filter(isBlack).map((k) => (
                <div
                  key={`b${k}`}
                  className="absolute left-0 right-0 bg-muted/15"
                  style={{ top: keyTop(k), height: rowH }}
                />
              ))}
              {KEYS.filter((k) => pc(k) === 0).map((k) => (
                <div
                  key={`o${k}`}
                  className="absolute left-0 right-0 border-t border-border/30"
                  style={{ top: keyTop(k) }}
                />
              ))}
              {/* The ruler's own lines, carried down over the notes — every subdivision it
                  drew, at its three weights one step fainter. The same layer the timeline puts
                  under its lanes (Ruler.tsx), so a position reads the same in both. */}
              <Grid
                mode="bars"
                beatLo={origin}
                lastBeat={gridEnd}
                unit={gridUnit}
                barBeats={barBeats}
                bps={bps}
                secStep={gridSecStep}
                scroller={bodyRef}
                ppb={ppb}
                laneW={laneW}
                left0={0}
                top={0}
                height={gridH}
              />
              {/* The caret cell, and the rectangle it grows into — under the notes, so a note
                  never disappears behind its own selection. Gone while a rectangle is live: the
                  rectangle IS the caret then, with two ends (the timeline's rule).
                  pointer-events-none because both are marks, not targets: a press landing on one
                  has to read as a press on the lane, which is what moves the caret. */}
              {active && !box && (
                <div
                  className="pointer-events-none absolute bg-primary/25 outline outline-1 -outline-offset-1 outline-primary"
                  style={{
                    left: (beatOfCol(caret.col) - origin) * ppb,
                    width: Math.max(1, gridUnit * ppb),
                    top: caret.row * rowH,
                    height: Math.max(1, rowH),
                  }}
                />
              )}
              {active && box && (
                <div
                  className="pointer-events-none absolute bg-primary/25 outline outline-1 -outline-offset-1 outline-primary"
                  style={{
                    left: (beatOfCol(box.colLo) - origin) * ppb,
                    width: Math.max(
                      1,
                      (box.colHi - box.colLo + 1) * gridUnit * ppb,
                    ),
                    top: box.rowLo * rowH,
                    height: Math.max(1, (box.rowHi - box.rowLo + 1) * rowH),
                  }}
                />
              )}
              {/* THE EVENT'S WINDOW, as ground — the span this placement plays, lit under
                  everything with its two edges picked out. The same mark the audio clip panel
                  draws over its wave, for the same reason and in the same grammar: the canvas
                  roams the whole sequence, and this is what says which part of it sounds and
                  where an edit may land.

                  Colourless on purpose. This pane already spends primary on the caret, emerald on
                  a note and violet on a loop; a fifth hue for the thing all of those sit INSIDE
                  would compete with every one of them. */}
              {act && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-0 border-x border-white/50 bg-white/[0.06]"
                  style={{
                    left: (act.from - origin) * ppb,
                    width: Math.max(1, (act.to - act.from) * ppb),
                  }}
                />
              )}
              {visNotes.map((n, i) => {
                const top = keyTop(n.key);
                const h = Math.max(1, rowH - 1);
                // What this note is worth: the file's `vel`, or the drag's live value while it is
                // the one being dragged. Absent IS the schema's default of 1 — see WebNote.
                const live =
                  vDraw && vDraw.key === n.key && vDraw.time === n.time
                    ? vDraw.vel
                    : (n.vel ?? 1);
                // Where the velocity sits in the note: 0 at its bottom edge, 1 at its top.
                const lineY = (1 - live) * (h - 1);
                // Is THIS the note being moved or stretched, and where has it got to? Addressed
                // the way the command addresses it — key and current start — so the draft cannot
                // land on a different note than the write will.
                const dragging =
                  !!tDraw && tDraw.key === n.key && tDraw.time === n.time;
                // The SAME arithmetic the commit runs (`tSpan`), so the ghost lands exactly where
                // the write will — an edge drawn from a second copy of this would drift from it.
                const span = dragging && tDraw ? tSpan(tDraw) : null;
                const drawStart = span ? span.start : n.time;
                const drawDur = span ? span.end - span.start : n.duration;
                // Does this note SOUND in the event? One that does not is context: drawn, so the
                // window can be judged against what is around it, and not a target — dragging it
                // would edit material this placement does not play.
                const plays = notePlays(n);
                return (
                  <div
                    key={i}
                    title={
                      plays
                        ? `${noteName(n.key)} · ${n.time}–${n.time + n.duration}b · vel ${+live.toFixed(2)}${
                            onSetVelocity
                              ? " — drag the white line for velocity"
                              : ""
                          }${
                            onSetNoteRange
                              ? ", the body to move, either edge to stretch"
                              : ""
                          }`
                        : `${noteName(n.key)} · ${n.time}–${n.time + n.duration}b — outside this event's window`
                    }
                    onPointerDown={
                      plays ? (e) => onNotePointerDown(e, n) : undefined
                    }
                    onPointerMove={
                      plays ? (e) => onNotePointerMove(e, top) : undefined
                    }
                    onPointerUp={plays ? endVDrag : undefined}
                    onLostPointerCapture={plays ? endVDrag : undefined}
                    className={cn(
                      "absolute overflow-hidden rounded-[1px] touch-none",
                      !plays && "pointer-events-none opacity-30",
                      plays &&
                        (onSetNoteRange
                          ? "cursor-grab"
                          : onSetVelocity && "cursor-ns-resize"),
                      // A move outranks the velocity cursor while one is happening: the pointer
                      // should say which gesture it is IN, not which it could have started.
                      dragging &&
                        (tDraw?.mode === "move"
                          ? "cursor-grabbing"
                          : "cursor-ew-resize"),
                    )}
                    style={{
                      top,
                      height: h,
                      // The note follows the hand while it is the one being dragged, so the roll
                      // shows where it will land before anything is written. Nothing is committed
                      // until release — this is a picture, not an edit.
                      left: ((dragging ? drawStart : n.time) - origin) * ppb,
                      width: Math.max(
                        2,
                        (dragging
                          ? drawDur
                          : n.duration > 0
                            ? n.duration
                            : 0.25) * ppb,
                      ),
                    }}
                  >
                    {/* The note reads as a LEVEL before the line is looked for: above the velocity
                        it is a little transparent, below it solid. The colour lives on these two
                        rather than on the box, so "80%" means the note's own fill and not a wash of
                        whatever happens to be behind it. */}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 bg-emerald-500/80"
                      style={{ height: lineY }}
                    />
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-emerald-500"
                      style={{ top: lineY }}
                    />
                    {/* The line itself: half the note's width, centred, so it reads as a mark ON the
                        note rather than as its edge. A note a couple of pixels tall has nowhere to
                        put it — the level split above still says what it is worth, and the body is
                        then the only grip there is.

                        It is also the velocity HANDLE, inside a grab zone `VEL_PX` either side: a
                        one-pixel target is not one, and the same reasoning sizes the waveform's
                        slice grips. The zone takes the press and the line inside it is drawn
                        `pointer-events-none`, so what you see is the mark and what you catch is the
                        band around it. */}
                    {h >= 4 && (
                      <div
                        onPointerDown={(e) => onNotePointerDown(e, n, "line")}
                        onPointerMove={(e) => onNotePointerMove(e, top)}
                        onPointerUp={endVDrag}
                        onLostPointerCapture={endVDrag}
                        className={cn(
                          "absolute left-1/4 w-1/2",
                          onSetVelocity && "cursor-ns-resize",
                        )}
                        style={{
                          top: lineY - VEL_PX,
                          height: 2 * VEL_PX + 1,
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-x-0 h-px bg-white"
                          style={{ top: VEL_PX }}
                        />
                      </div>
                    )}

                    {/* The two STRETCH grips, one per edge — the timeline's arrangement, and the
                        reason a note is resized the same way an event is. Boxes rather than a
                        hit-test on the press: the cursor then says where the handle IS before you
                        commit to the drag, which a coordinate test cannot do.

                        LAST in the note, so on a narrow one they paint over the body and the right
                        grip over the left — the same overlap the timeline resolves the same way.
                        Invisible: the note's own edge is the mark, and a pair of drawn tabs on
                        every note in a dense roll would be all you could see. */}
                    {onSetNoteRange && plays && (
                      <>
                        <div
                          onPointerDown={(e) =>
                            onNotePointerDown(e, n, "start")
                          }
                          onPointerMove={(e) => onNotePointerMove(e, top)}
                          onPointerUp={endVDrag}
                          onLostPointerCapture={endVDrag}
                          className="absolute inset-y-0 left-0 cursor-ew-resize"
                          style={{ width: EDGE_PX }}
                        />
                        <div
                          onPointerDown={(e) => onNotePointerDown(e, n, "end")}
                          onPointerMove={(e) => onNotePointerMove(e, top)}
                          onPointerUp={endVDrag}
                          onLostPointerCapture={endVDrag}
                          className="absolute inset-y-0 right-0 cursor-ew-resize"
                          style={{ width: EDGE_PX }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
              {draftBox && (
                <div
                  className="pointer-events-none absolute z-10 rounded-[1px] bg-emerald-300/80 outline outline-1 outline-emerald-200"
                  style={{
                    top: draftBox.top,
                    height: Math.max(1, rowH - 1),
                    left: draftBox.left,
                    width: draftBox.width,
                  }}
                />
              )}
              <RollPlayhead
                tempo={project.tempo}
                clipStart={clip.start}
                placedEnd={placedEnd}
                span={canvasBeats}
                ppb={ppb}
                height={gridH}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The transport line, and the only part of the roll that knows the transport.
 *
 * Held apart from the body for the same reason the timeline holds its own apart: the body draws
 * 128 key rows, the black-key stripes, the octave lines and a div per bar before it draws a
 * single note, and reading the playhead up there reconciled all of it 20 times a second. It is
 * translated rather than re-`left`-ed — a transport that moves 20 times a second should not be
 * laying anything out.
 */
function RollPlayhead({
  tempo,
  clipStart,
  placedEnd,
  span,
  ppb,
  height,
}: {
  tempo: number;
  clipStart: number;
  /** The clip's extent on the timeline — where the transport stops being this clip's business. */
  placedEnd: number;
  /** Beats the canvas draws. A windowed clip's later passes FOLD back into it — the view is one
   *  pass, and the transport is always somewhere in it. */
  span: number;
  ppb: number;
  height: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Per animation frame, written onto the node — see docs/playhead.md. Hidden rather than
  // unmounted when the transport is outside this clip: the callback needs somewhere to write
  // on the frame it comes back.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const localBeat = (seconds * tempo) / 60 - clipStart;
        const inside = localBeat >= 0 && localBeat <= placedEnd;
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside)
          el.style.transform = `translateX(${(span > 0 ? localBeat % span : 0) * ppb}px)`;
      },
      [tempo, clipStart, placedEnd, span, ppb],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 z-10 w-px bg-white/80"
      style={{
        willChange: "transform",
        visibility: "hidden", // until the first frame says where it is
        height,
      }}
    />
  );
}
