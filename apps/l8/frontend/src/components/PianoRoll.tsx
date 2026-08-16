// PianoRoll.tsx — a piano-roll view/editor of a MIDI clip. A clip that states a window
// (`from`/`to`) is CAGED to it: the canvas spans the window and what is outside is not drawn;
// without one it opens zoomed to fit its notes and the canvas runs to the placed extent
// (rollFit.ts, docs/clipEditors.md). Left-click-drag draws a note (press = pitch + start,
// release = end) via `sequence note new`; a pinch zooms time, a plain wheel and a middle-drag
// pan. Drawn by the Editor bottom panel and, when a clip is clicked, where the graph is (ClipView).

import { cn } from "@frediverse/ui/lib/utils";
import { useHZoom, usePanScroll } from "@studio/ui-timeline/panZoom";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { clipLoop } from "../clipLoop";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { m } from "../paraglide/messages.js";
import { rollFit } from "../rollFit";
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

  // Only what the window contains is drawn. A note over the edge is kept and CUT there — the lane
  // clips it — so material half-in still reads as present; one wholly outside does not exist here.
  const visNotes = notes.filter(
    (n) => n.time < origin + canvasBeats && n.time + n.duration > origin,
  );

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

  // --- left-click-drag to draw a note ----------------------------------------------
  // A live draft while dragging: pitch fixed at the press row, time from press to cursor.
  const [draft, setDraft] = useState<{
    k: number;
    t0: number;
    t1: number;
  } | null>(null);
  const drag = useRef<{ k: number; t0: number } | null>(null);

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

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !onCreateNote) return; // left-draw only; middle pans
    e.preventDefault();
    const { beat, key } = atEvent(e);
    drag.current = { k: key, t0: beat };
    setDraft({ k: key, t0: beat, t1: beat });
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const { beat: b } = atEvent(ev);
      setDraft({ k: drag.current.k, t0: drag.current.t0, t1: b });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      setDraft(null);
      if (!d) return;
      const { beat: b } = atEvent(ev);
      const t0 = Math.min(d.t0, b);
      const t1 = Math.max(d.t0, b);
      // A plain click (no real drag) leaves the length to the command's default.
      onCreateNote(d.k, t0, t1 - t0 > 0.01 ? t1 : t0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * --- drag a note's VELOCITY -------------------------------------------------------
   *
   * The note's own box is the handle, and the line follows the pointer inside it: 0 at the bottom
   * edge, 1 at the top, which is the geometry velocity is read with everywhere. That does mean a
   * press on a note no longer starts drawing one over it — no loss, since two notes cannot share a
   * key and a start anyway.
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
   * The same press that sets velocity also moves and stretches, and WHICH of the three it is
   * comes from the grip and then from the direction:
   *
   * - press within `EDGE_PX` of the note's right edge → stretch. An edge is a handle everywhere
   *   else in this app (the waveform's slice, the timeline's event), so it is one here too.
   * - press anywhere else → undecided until the pointer travels: mostly sideways moves the note,
   *   mostly up/down sets its velocity. Deciding on the FIRST real movement rather than asking for
   *   a modifier is what keeps the roll a one-handed instrument.
   *
   * Nothing is written until release, and a press that never travels writes nothing at all — a
   * stray click on a note must not rewrite where it is or what it is worth.
   */
  const EDGE_PX = 6;
  interface TDrag {
    key: number;
    time: number; // where it starts NOW — how the command addresses it
    dur: number;
    mode: "move" | "resize";
    dBeats: number; // how far it has travelled, in beats
  }
  const [tDraw, setTDraw] = useState<TDrag | null>(null);
  const tDrag = useRef<TDrag | null>(null);
  // Which gesture this press became, once it has travelled far enough to say. The ref is the live
  // one for the same reason the velocity drag's is: a command fired from a state updater runs
  // twice under StrictMode.
  const gesture = useRef<"pending" | "vel" | "time" | null>(null);
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

  const onNotePointerDown = (
    e: React.PointerEvent,
    n: { key: number; time: number; duration: number; vel?: number },
  ) => {
    if (e.button !== 0 || (!onSetVelocity && !onSetNoteRange)) return;
    e.preventDefault();
    e.stopPropagation(); // not a new note: this press belongs to the one already here
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    // The right edge is a stretch handle, and it is claimed on the PRESS: a grip is a place, not
    // a direction, so it does not wait to see which way the hand goes.
    const right = e.currentTarget.getBoundingClientRect().right;
    const onEdge = !!onSetNoteRange && right - e.clientX <= EDGE_PX;
    const t: TDrag = {
      key: n.key,
      time: n.time,
      dur: n.duration,
      mode: onEdge ? "resize" : "move",
      dBeats: 0,
    };
    tDrag.current = t;
    const v = { key: n.key, time: n.time, vel: n.vel ?? 1, moved: false };
    vDrag.current = v;
    gesture.current = onEdge ? "time" : "pending";
    if (onEdge) setTDraw(t);
  };

  const onNotePointerMove = (e: React.PointerEvent, top: number) => {
    if (!gesture.current) return;
    const from = pressAt.current;
    // Undecided until the press has actually travelled. 4px, the same threshold the waveform's
    // pins use to tell a click from a drag.
    if (gesture.current === "pending" && from) {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      gesture.current =
        Math.abs(dx) > Math.abs(dy) && onSetNoteRange ? "time" : "vel";
      if (gesture.current === "vel" && !onSetVelocity) {
        gesture.current = null;
        return;
      }
    }
    if (gesture.current === "vel") {
      const d = vDrag.current;
      if (!d) return;
      const next = { ...d, vel: velAt(e.clientY, top), moved: true };
      vDrag.current = next;
      setVDraw(next);
      return;
    }
    const d = tDrag.current;
    if (!d || !from) return;
    const next = { ...d, dBeats: (e.clientX - from.x) / Math.max(1, ppb) };
    tDrag.current = next;
    setTDraw(next);
  };

  /**
   * Commit whichever gesture this was.
   *
   * A resize keeps the start and moves the end; a move slides both and keeps the length. Both go
   * through ONE command, because on the roll they are one gesture with two grips — see
   * `sequence note timerange`.
   *
   * A move is clamped at zero rather than refused: dragging a note off the front of the sequence
   * means "to the beginning", and a gesture that silently did nothing would read as a dead roll.
   */
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
      const start = t.mode === "move" ? Math.max(0, t.time + t.dBeats) : t.time;
      const end =
        t.mode === "move"
          ? start + t.dur
          : Math.max(t.time + MIN_NOTE_BEATS, t.time + t.dur + t.dBeats);
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
              · drag to draw · pinch to zoom · middle-drag pan
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
                ppb={ppb}
                laneW={laneW}
                left0={0}
                top={0}
                height={gridH}
              />
              {/* No loop band, no repeat lines: the canvas IS the window now (rollFit cages it),
                  so the violet layer would frame everything and mark nothing. The header still
                  states the loop and its pass count in words. */}
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
                const drawStart =
                  dragging && tDraw.mode === "move"
                    ? Math.max(0, n.time + tDraw.dBeats)
                    : n.time;
                const drawDur = dragging
                  ? tDraw.mode === "move"
                    ? n.duration
                    : Math.max(MIN_NOTE_BEATS, n.duration + tDraw.dBeats)
                  : n.duration;
                return (
                  <div
                    key={i}
                    title={`${noteName(n.key)} · ${n.time}–${n.time + n.duration}b · vel ${+live.toFixed(2)}${
                      onSetVelocity ? " — drag up/down for velocity" : ""
                    }${
                      onSetNoteRange
                        ? ", sideways to move, the right edge to stretch"
                        : ""
                    }`}
                    onPointerDown={(e) => onNotePointerDown(e, n)}
                    onPointerMove={(e) => onNotePointerMove(e, top)}
                    onPointerUp={endVDrag}
                    onLostPointerCapture={endVDrag}
                    className={cn(
                      "absolute overflow-hidden rounded-[1px]",
                      onSetVelocity && "cursor-ns-resize touch-none",
                      // A move outranks the velocity cursor while one is happening: the pointer
                      // should say which gesture it is IN, not which it could have started.
                      dragging &&
                        (tDraw?.mode === "resize"
                          ? "cursor-ew-resize"
                          : "cursor-grabbing"),
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
                        put it — the level split above still says what it is worth. */}
                    {h >= 4 && (
                      <div
                        className="pointer-events-none absolute left-1/4 h-px w-1/2 bg-white"
                        style={{ top: lineY }}
                      />
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
