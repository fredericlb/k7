// PianoRoll.tsx — a piano-roll view/editor of a MIDI clip. A clip that states a window
// (`from`/`to`) is FRAMED on it with a margin either side, the canvas still spanning the whole
// sequence: what is outside sounds in no pass, so it is drawn dimmed and cannot be edited
// (rollFit.ts, docs/clipEditors.md). Left-click-drag draws a note via `sequence note new`, a body
// drag moves it in TIME and in PITCH, either edge stretches it, and `x` removes what the caret is
// on. What each gesture writes is rollDrag.ts, where it is tested; a wheel zooms and middle drags pan.
// The gestures themselves are ../hooks/useRollGestures.ts; this file is the layout and the drawing.
// Drawn by the Editor bottom panel and, when a clip is clicked, where the graph is (ClipView).

import { Piano } from "@frediverse/ui/icons";
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
import {
  copyNotes,
  droppedCount,
  notesInRegion,
  pasteNotes,
} from "../clipboard";
import { clipLoop, playedZone } from "../clipLoop";
import type { MenuCtx } from "../contextMenu";
import {
  type ClipGridHandle,
  cellBox,
  colSpan,
  type OnGridSelection,
  selBox,
  songSecondsOfCol,
} from "../gridCaret";
import { useGridCaret } from "../hooks/useGridCaret";
import { useRollGestures } from "../hooks/useRollGestures";
import { cursorOf, ModeStrip } from "../modeIcons";
import { isBlack, noteName, pc } from "../noteNames";
import { m } from "../paraglide/messages.js";
import { groupOffset, tSpan } from "../rollDrag";
import { rollFit } from "../rollFit";
import {
  ROLL_MODES,
  ROLL_PRESS,
  ROLL_SOLO_MODES,
  type RollMode,
} from "../rollMode";
import {
  noteAddr,
  paintNotes,
  type RollNote,
  settledNotes,
} from "../rollPending";
import type { WebClip, WebProject } from "../types";
import { KEYS, KeyGutter, N_NOTES } from "./KeyGutter";
import { LoopBrace, LoopToggle } from "./LoopBrace";
import { RollPlayhead } from "./RollPlayhead";
import { ArrangementRuler, Grid, RulerTicks, rulerScale } from "./Ruler";
import { SeqDoubleButton } from "./SeqDoubleButton";
import { type PanelTakes, TakesView } from "./TakesView";

/** How loud a click on a row's NAME auditions it — half, a check of which sound this is rather than a performance. */
export const AUDITION_VEL = 0.5;

const PX_PER_BEAT = 24; // fallback beat width for the first, unmeasured frame only
const GUTTER = 44; // note-name column, px
const NAMED_GUTTER = 112; // …wide enough for a sample's name, when the lane's rack gives its keys one
const RULER_H = 18; // bar/beat ruler height, px

/** What the shell drives on the ROLL — the third of these, beside `TimelineHandle` and `AudioClipHandle`. */
export interface RollHandle {
  setMode: (m: RollMode) => void;
}

export function PianoRoll({
  project,
  clip,
  modes,
  caretRef,
  active = false,
  setStatus,
  onSelection,
  onSetLoop,
  onLoop,
  onLoopPoints,
  onSeek,
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
  onMoveNote,
  onMoveNotes,
  onRemoveNote,
  onContextMenu,
  onPreviewNote,
  onCommand,
  modeRef,
  onModeChange,
  takes,
  reloadKey = 0,
  keyNames,
}: {
  project: WebProject;
  clip: WebClip;
  /** The clip pane's view switch, drawn at the end of the header; absent for a host with no other view of these notes. */
  modes?: ReactNode;
  /** Where the shell reaches the caret: `v`, `t` and Shift+L are commands, so they arrive from the bar (see ClipView's ClipViewHandle). */
  caretRef?: RefObject<ClipGridHandle | null>;
  /** Whether this pane owns the keys — the arrows must not move two carets at once; a preview passes nothing and gets none. */
  active?: boolean;
  setStatus?: (s: string) => void;
  /** Whether a rectangle is live — pushed up, since a condition cannot read a ref. */
  onSelection?: OnGridSelection;
  /** Set or clear the transport's loop region, in SONG seconds — Shift+L on the rectangle. */
  onSetLoop?: (fromSec: number, toSec: number, on: boolean) => void;
  /** Switch the EVENT's own loop — `event loop`; absent for a sequence file, which no event places. */
  onLoop?: (on: boolean) => void;
  /** Move its loop points, in the NOTES' beats — `event loop points`. */
  onLoopPoints?: (from: number, to: number) => void;
  /** Seek the transport, in SONG seconds — what a click on the arrangement ruler does. */
  onSeek?: (seconds: number) => void;
  // Draw a note via `sequence note new`, ANSWERING the command's promise like the three below (rollPending.ts); absent, the roll is read-only.
  onCreateNote?: (
    key: number,
    startBeat: number,
    endBeat: number,
  ) => void | Promise<void>;
  /** Commit a note's velocity via `sequence note velocity` — 0..1; absent ⇒ nothing to write to, though the line is still DRAWN. */
  onSetVelocity?: (
    key: number,
    startBeat: number,
    vel: number,
  ) => void | Promise<void>;
  /** Commit a note's new time range via `sequence note timerange`, in beats — absent ⇒ notes cannot be moved or stretched. */
  onSetNoteRange?: (
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void | Promise<void>;
  /** Commit a note's new PITCH via `sequence note move`, which keeps the duration — absent ⇒ a drag stays horizontal. */
  onMoveNote?: (
    key: number,
    startBeat: number,
    newKey: number,
    newStart: number,
  ) => void | Promise<void>;
  /** Move SEVERAL notes via `sequence notes move` — a dragged selection, one write; absent ⇒ a drag moves only the note in hand. */
  onMoveNotes?: (
    moves: [number, number, number, number][],
  ) => void | Promise<void>;
  /** Remove one note via `sequence note remove` — what the `remove` mode's press runs (rollMode.ts). */
  onRemoveNote?: (key: number, startBeat: number) => void | Promise<void>;
  /** The shell's right-click menu, for a note's own two verbs — remove, and split at the caret (contextMenu.ts). */
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /** Hear a note as it is pressed, through the track's own chain — absent when nothing knows which track that is. */
  onPreviewNote?: (key: number, vel: number) => void;
  /** Runs a command line through the shell — the strip's own way of switching mode, a button dispatching rather than doubling. */
  onCommand?: (line: string) => void | Promise<void>;
  /** Where the shell reaches this roll's MODE — `ui roll <mode>` arrives here, as the other two surfaces' do. */
  modeRef?: RefObject<RollHandle | null>;
  /** …and the same fact going up, for the key conditions and the footer's badge. */
  onModeChange?: (m: RollMode | null) => void;
  /** The takes mode's event and shell half; absent, the mode is not offered (song docs/takes.md). */
  takes?: PanelTakes;
  /** What a take row re-reads its sequence on. */
  reloadKey?: number;
  /** The sample each key fires, from the lane's rack (rackFor.ts): those keys show it, every other key its note name. */
  keyNames?: ReadonlyMap<number, string>;
}) {
  const named = keyNames != null && keyNames.size > 0;
  const gutter = named ? NAMED_GUTTER : GUTTER;
  /** Where a press goes — CHOSEN, and `select` by default: the roll opens ready to read rather than ready to write. */
  // …except on a comped event, whose notes are its takes': it opens on them (song docs/takes.md).
  const [mode, setMode] = useState<RollMode>(
    takes?.ev.comp.length ? "takes" : "select",
  );
  const showTakes = mode === "takes" && !!takes;
  // `select` keeps the system's arrow: framing is what an arrow already means, and a picture of one is worse than one.
  const rollCursor =
    mode === "select" || mode === "takes" ? undefined : cursorOf(mode);
  useImperativeHandle(modeRef, (): RollHandle => ({ setMode }), []);
  useEffect(() => onModeChange?.(mode), [mode, onModeChange]);
  // …and NULL on the way out, so an audio clip opened next does not leave the shell believing a roll is on screen.
  useEffect(() => () => onModeChange?.(null), [onModeChange]);
  /** Edits the document has not caught up with: each is painted at once and held until it AGREES (rollPending.ts). */
  const [pending, setPending] = useState<Map<string, RollNote | null>>(
    new Map(),
  );
  const inFlight = useRef(0);
  useEffect(() => {
    setPending((cur) => {
      if (!cur.size) return cur;
      // Nothing in flight and a document has landed: it has the last word, so a ghost that still disagrees was a command that FAILED.
      if (inFlight.current === 0) return new Map();
      const done = settledNotes(clip.notes, cur);
      if (!done.length) return cur;
      const next = new Map(cur);
      for (const k of done) next.delete(k);
      return next;
    });
  }, [clip.notes]);
  // A different clip's ghosts are not this one's.
  useEffect(() => {
    setPending(new Map());
  }, [clip.id]);
  /** Ghost an edit at `addr` — where the note is NOW, which is how the verb addresses it (docs/clipEditors.md). */
  const paint = (edits: [string, RollNote | null][]) =>
    setPending((cur) => {
      const next = new Map(cur);
      for (const [a, to] of edits) next.set(a, to);
      return next;
    });
  const commit = (
    addr: string,
    to: RollNote | null,
    run: () => void | Promise<void>,
  ) => {
    paint([[addr, to]]);
    inFlight.current++;
    void Promise.resolve(run()).finally(() => {
      inFlight.current--;
    });
  };

  const notes = paintNotes(clip.notes, pending);
  /** The note a gesture is on, as the ROLL currently reads it — a ghost carries the fields the edit does not name. */
  const docNote = (key: number, time: number) =>
    notes.find((n) => n.key === key && Math.abs(n.time - time) < 1e-6);
  const noteDur = (key: number, time: number) =>
    docNote(key, time)?.duration ?? 0;
  // The sequence a note command names — the same rule every caller of `sequence note …` uses.
  const seqId = clip.name || clip.id;
  const barBeats = Math.max(1, project.timeSigNumerator || 4);
  // The window that repeats, on this roll's own beat axis — null for a clip that states no loop.
  const loop = clipLoop(clip);
  /** Whether the EVENT repeats — its own `loop`, which the header's switch writes; a window alone is not a loop. */
  const looped = (clip.event?.loop ?? 1) > 1;

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
  const [zoomX, setZoomX] = useHZoom(bodyRef, { gutter });
  usePanScroll(bodyRef);

  // A DIFFERENT clip opens at fit: nothing else let go of the zoom multiplier, so a sequence inherited the last one's scale.
  useEffect(() => {
    setZoomX(1);
  }, [clip.id, setZoomX]);

  // What the view opens on, both axes (rollFit.ts, where the arithmetic is tested); `origin` is the beat at the left edge.
  const fit = rollFit(notes, clip.length, barBeats, loop);
  const { placedEnd, canvasBeats, origin } = fit;
  const fitHiK = fit.hiKey;
  const fitBeatLo = fit.loBeat;

  // Everything the canvas spans is drawn: a note over an edge is kept and CUT there, so material half-in still reads as present.
  const visNotes = notes.filter(
    (n) => n.time < origin + canvasBeats && n.time + n.duration > origin,
  );
  /** The window THIS EVENT plays, and the one question every edit here asks — null only for an UNPLACED clip (see `playedZone`). */
  const act = playedZone(clip);
  const inAct = (beat: number) =>
    !act || (beat >= act.from - 1e-6 && beat <= act.to + 1e-6);
  // A note belongs to the event when it SOUNDS in it — the compiler's own overlap test, not 'starts inside'.
  const notePlays = (n: { time: number; duration: number }) =>
    !act || (n.time < act.to - 1e-6 && n.time + n.duration > act.from + 1e-6);

  // A PLACED clip stacks the ARRANGEMENT's ruler over its own; a sequence FILE has no placement and nothing global to point at.
  const placed = clip.length > 0;
  const rulersH = RULER_H * (placed ? 2 : 1);

  const availW = Math.max(0, pane.w - gutter);
  const availH = Math.max(0, pane.h - rulersH);
  // The fit's spans are taken ONCE per clip: re-fitting on every edit rescaled the roll under the note being dragged.
  const scaleFor = useRef<{ id: string; rows: number; beats: number }>(null);
  if (scaleFor.current?.id !== clip.id)
    scaleFor.current = { id: clip.id, rows: fit.rows, beats: fit.beats };
  const scale = scaleFor.current;
  // Base scales: the framed rows fill the height and the framed beat span the width, then zoomX stretches the time axis.
  const rowH = availH > 0 ? availH / scale.rows : 12;
  const ppb0 = availW > 0 ? availW / scale.beats : PX_PER_BEAT;
  const ppb = ppb0 * zoomX;
  const laneW = canvasBeats * ppb;
  const gridH = N_NOTES * rowH;
  const keyTop = (k: number) => (127 - k) * rowH;
  const showLabels = rowH >= 9; // a row too short for 9px text is labelled nowhere

  // Frame the fit once measured, and again for a different clip. Adding notes keeps clip.id, so the view stays.
  const framedFor = useRef<string>("");
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || availH <= 0) return;
    if (framedFor.current === clip.id) return;
    // Wait for the reset above to land: on the commit that changed `clip.id`, `ppb` still carries the previous clip's multiplier.
    if (zoomX !== 1) return;
    framedFor.current = clip.id;
    el.scrollTop = (127 - fitHiK) * rowH; // top of the fit pitch range
    el.scrollLeft = (fitBeatLo - origin) * ppb; // …and the left edge of the fitted span
  }, [clip.id, availH, rowH, fitHiK, fitBeatLo, origin, ppb, zoomX]);

  /** The file's own ruler and the grid under it, on the SHARED ladder, in ABSOLUTE beats — the file's numbering, `origin` included. */
  const gridEnd = origin + canvasBeats;
  const bps = Math.max(1e-6, project.tempo / 60);
  const {
    unit: gridUnit,
    secStep: gridSecStep,
    barStride: gridStride,
  } = rulerScale("bars", ppb, barBeats, bps, gridEnd);

  /** The caret and its `v` rectangle on the roll's own grid (gridCaret.ts) — a row is a PITCH, a column one step of the ruler's unit. */
  const gridCols = Math.max(1, Math.ceil(canvasBeats / gridUnit));
  const grid = useGridCaret({
    active,
    rows: N_NOTES,
    cols: gridCols,
    // The unit is in the key: a caret left at column 12 is a different MOMENT once the zoom halves the step.
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

  /** What the shell's three region verbs act on: the rectangle, or the caret's own cell when there is none. */
  const caretBox = () =>
    grid.sel ? selBox(grid.sel) : cellBox({ row: caret.row, col: caret.col });
  /** …and the notes it holds, by the rule `copyNotes` applies — so copying and deleting cannot disagree about one box. */
  const caretNotes = () => {
    const b = caretBox();
    return notesInRegion(
      notes,
      127 - b.rowHi,
      127 - b.rowLo,
      beatOfCol(b.colLo),
      beatOfCol(b.colHi + 1),
    );
  };

  useImperativeHandle(
    caretRef,
    (): ClipGridHandle => ({
      toggleSelect: grid.toggleSelect,
      // `t`: the caret's step as a moment in the SONG, through the placement, so it agrees with the ruler stacked above it.
      seekToCaret: () =>
        onSeek?.(
          songSecondsOfCol(caret.col, gridUnit, clip.start, project.tempo),
        ),
      /** Shift+L: the rectangle becomes the loop region, out to the FAR edge of its last column; with none it CLEARS. */
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
      /** `selection copy` — the notes the rectangle holds, in its own coordinates; with no rectangle the caret's cell is one. */
      copy: () => {
        const b = caretBox();
        return copyNotes(
          notes,
          seqId,
          127 - b.rowHi,
          127 - b.rowLo,
          beatOfCol(b.colLo),
          beatOfCol(b.colHi + 1),
        );
      },
      /** `selection paste` — one `sequence note add` at the caret's TIME, the copy's start on it; each note keeps its own pitch. */
      pasteLine: (c) => {
        if (c.kind !== "notes")
          return {
            note: m["grid.clipboardHasEvents"](),
          };
        const out = pasteNotes(c, c.top, beatOfCol(caret.col));
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
      /** `selection delete` — what the rectangle holds, or the caret's cell; one line, so N notes are one Ctrl+Z. */
      deleteLine: () => {
        const hit = caretNotes();
        if (!hit.length) return { note: m["grid.nothingToDelete"]() };
        // Painted here rather than through `commit`: the SHELL runs the line, so there is no promise to hold the ghost against.
        paint(hit.map((n) => [noteAddr(n.key, n.time), null]));
        if (hit.length === 1)
          return {
            line: `sequence note remove ${seqId} ${hit[0].key} ${hit[0].time}`,
            note: m["grid.noteDeleted"]({ note: noteName(hit[0].key) }),
          };
        const b = caretBox();
        return {
          line: `sequence notes remove ${seqId} ${127 - b.rowHi} ${127 - b.rowLo} ${beatOfCol(b.colLo)} ${beatOfCol(b.colHi + 1)}`,
          note: m["grid.notesDeleted"]({ n: hit.length }),
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

  // What the rectangle is, in words — pitches rather than rows: on a roll a row IS a note name.
  useEffect(() => {
    if (!active || !box) return;
    const steps = box.colHi - box.colLo + 1;
    setStatus?.(
      m["roll.selection"]({
        steps,
        unit: gridUnit >= 1 ? `${gridUnit}b` : `1/${Math.round(1 / gridUnit)}`,
        from: noteName(127 - box.rowHi),
        to: noteName(127 - box.rowLo),
      }),
    );
  }, [active, box, gridUnit, setStatus]);

  /** Every pointer gesture on the lane and the notes — what this file draws while one is in hand comes back with them (useRollGestures.ts). */
  const {
    draft,
    tDraw,
    vDraw,
    groupDraw,
    EDGE_PX,
    VEL_PX,
    onLanePointerDown,
    onNoteMenu,
    onNotePointerDown,
    onNotePointerMove,
    endVDrag,
  } = useRollGestures({
    mode,
    grid,
    laneRef,
    notes,
    notePlays,
    inAct,
    docNote,
    noteDur,
    seqId,
    geo: { origin, canvasBeats, rowH, ppb, gridUnit, beatOfCol, colOfBeat },
    edits: {
      onCreateNote,
      onSetVelocity,
      onSetNoteRange,
      onMoveNote,
      onMoveNotes,
      onRemoveNote,
      onContextMenu,
      onPreviewNote,
    },
    commit,
    paint,
    inFlight,
    setStatus,
  });

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
        <span className="font-semibold text-primary-text">
          <Piano className="h-3.5 w-3.5" /> {clip.name || clip.id}
        </span>
        <span className="text-muted-foreground">
          {visNotes.length} notes
          {/* What the cage hides, counted, so notes sitting before a file's `from` read as windowed rather than as data lost. */}
          {notes.length > visNotes.length &&
            ` (${m["roll.outsideWindow"]({
              n: notes.length - visNotes.length,
            })})`}{" "}
          · {Math.round(placedEnd)} beats
          {/* What the marks add up to, said in words: ten passes of eight beats is not an 80-beat pattern, though the pane is as wide. */}
          {loop && (
            <span className="ml-2 text-violet-400">
              · loop {+loop.win.toFixed(3)}b
              {loop.passes > 1 && ` × ${loop.passes}`}
            </span>
          )}
          {onCreateNote && (
            <span className="ml-2 text-faint">
              · drag to draw · x supprime · ctrl: hors grille · pinch to zoom ·
              middle-drag pan
            </span>
          )}
        </span>
        {/* The right end of the bar, whatever it holds: the ✕ then needs no margin rule of its own. */}
        <span className="ml-auto flex items-center gap-1">
          {/* Editable rolls only — `onCreateNote` is what says this one is (docs/clipEditors.md). */}
          <LoopToggle on={looped} onToggle={onLoop} />
          <SeqDoubleButton
            seqId={seqId}
            command={onCreateNote ? onCommand : undefined}
          />
          {modes}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* The three modes as a 32px column — the only way to one a finger has, the keys and the bar being the other two. */}
        {onModeChange && (
          <ModeStrip
            modes={takes ? ROLL_MODES : ROLL_SOLO_MODES}
            current={mode}
            onPick={(m) => void onCommand?.(`ui roll ${m}`)}
            title={(mode) => `${mode} — ${ROLL_PRESS[mode]()}`}
          />
        )}
        {/* The TAKES mode draws in the lanes' place; the lanes stay mounted, hidden, so the caret and the scroll survive. */}
        {showTakes && takes && (
          <TakesView
            ev={takes.ev}
            host={takes.host}
            tempo={project.tempo}
            num={takes.num}
            den={takes.den}
            reloadKey={reloadKey}
            command={(line) => onCommand?.(line)}
            onSeek={onSeek}
          />
        )}
        <div
          ref={bodyRef}
          // The mode's own icon AS the pointer — `select` keeps the system's, framing being what an arrow already means.
          style={rollCursor ? { cursor: rollCursor } : undefined}
          className={cn(
            "relative min-h-0 flex-1 overflow-auto",
            rollCursor && "[&_*]:!cursor-[inherit]",
            showTakes && "hidden",
          )}
        >
          <div
            className="relative font-mono"
            style={{ width: gutter + laneW, height: rulersH + gridH }}
          >
            {/* The rulers, stacked and sticky as one: the SONG's positions on top, the file's own bars and beats below. */}
            <div className="sticky top-0 z-20 bg-background text-[10px] text-muted-foreground">
              {placed && (
                <div className="flex" style={{ height: RULER_H }}>
                  <div
                    className="sticky left-0 z-10 shrink-0 border-b border-r border-border bg-background"
                    style={{ width: gutter }}
                  />
                  <div
                    className="relative border-b border-border/50"
                    style={{ width: laneW }}
                  >
                    <ArrangementRuler
                      // The canvas starts at the FILE's beat `origin`, and the window's start is where the clip begins in the song.
                      startBeat={clip.start + origin - (loop?.from ?? 0)}
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
              {/* bars + beats ruler — the FILE's own numbering, window origin included, on the ladder every ruler here draws. */}
              <div className="flex" style={{ height: RULER_H }}>
                <div
                  className="sticky left-0 z-10 shrink-0 border-b border-r border-border bg-background"
                  style={{ width: gutter }}
                />
                <div
                  className="relative overflow-hidden border-b border-border"
                  style={{ width: laneW }}
                >
                  {/* The event's loop, on the axis its points are written in: the notes' own beats. */}
                  {looped && loop && onLoopPoints && (
                    <LoopBrace
                      from={loop.from}
                      to={loop.to}
                      toPx={(b) => (b - origin) * ppb}
                      fromPx={(x) => origin + x / ppb}
                      min={0}
                      max={origin + canvasBeats}
                      snap={(b) => Math.round(b / gridUnit) * gridUnit}
                      onCommit={onLoopPoints}
                    />
                  )}
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
              <KeyGutter
                width={gutter}
                rowH={rowH}
                showLabels={showLabels}
                keyNames={keyNames}
                onAudition={
                  onPreviewNote
                    ? (k) => onPreviewNote(k, AUDITION_VEL)
                    : undefined
                }
                onSelectKey={(k) => grid.selectRow(127 - k)}
              />
              <div
                ref={laneRef}
                // overflow-hidden is the cage's edge: a note crossing the window is drawn at its true beats and cut where it ends.
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
                {/* The ruler's own lines carried down over the notes, one step fainter — the layer the timeline puts under its lanes (Ruler.tsx). */}
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
                  // Bars as solid lines: a dense roll swallows the faint dashed ones the timeline's lanes can afford.
                  strongBars
                />
                {/* The caret cell and its rectangle, under the notes and `pointer-events-none`: both are marks, not targets (docs/clipEditors.md). */}
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
                {/* THE EVENT'S WINDOW as ground — the span this placement plays, colourless on purpose since four hues are already spent (docs/clipEditors.md). */}
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
                  const h = Math.max(1, rowH - 1);
                  // What this note is worth: the file's `vel`, or the drag's live value — absent IS the schema's default of 1.
                  const live =
                    vDraw && vDraw.key === n.key && vDraw.time === n.time
                      ? vDraw.vel
                      : (n.vel ?? 1);
                  // Where the velocity sits in the note: 0 at its bottom edge, 1 at its top.
                  const lineY = (1 - live) * (h - 1);
                  // Is THIS the note being moved or stretched — the one in hand, or any of a dragged selection's.
                  const inGroup =
                    !!tDraw &&
                    !!groupDraw?.some(
                      (g) => g.key === n.key && g.time === n.time,
                    );
                  const dragging =
                    inGroup ||
                    (!!tDraw && tDraw.key === n.key && tDraw.time === n.time);
                  // The SAME arithmetic the commit runs, so the ghost lands exactly where the write will — pitch included.
                  const off =
                    inGroup && tDraw && groupDraw
                      ? groupOffset(groupDraw, tDraw.dBeats, tDraw.dKeys)
                      : null;
                  const at = off
                    ? {
                        key: n.key + off.dKeys,
                        start: n.time + off.dBeats,
                        end: n.time + off.dBeats + n.duration,
                      }
                    : dragging && tDraw
                      ? tSpan(tDraw)
                      : null;
                  const drawStart = at ? at.start : n.time;
                  const drawDur = at ? at.end - at.start : n.duration;
                  // The row the note is DRAWN on, which a vertical drag moves; the velocity gesture never runs at the same time.
                  const top = keyTop(at ? at.key : n.key);
                  // Does this note SOUND in the event? One that does not is context: drawn, so the window can be judged, and not a target.
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
                                ? `, the body to move${onMoveNote ? " (up or down to transpose)" : ""}, either edge to stretch`
                                : ""
                            }`
                          : `${noteName(n.key)} · ${n.time}–${n.time + n.duration}b — outside this event's window`
                      }
                      onPointerDown={
                        plays ? (e) => onNotePointerDown(e, n) : undefined
                      }
                      onContextMenu={
                        plays ? (e) => onNoteMenu(e, n) : undefined
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
                        // A move outranks the velocity cursor while one is happening: the pointer says which gesture it is IN.
                        dragging &&
                          (tDraw?.mode === "move"
                            ? "cursor-grabbing"
                            : "cursor-ew-resize"),
                      )}
                      style={{
                        top,
                        height: h,
                        // The note follows the hand while it is being dragged — a picture, not an edit; nothing is committed until release.
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
                      {/* The note reads as a LEVEL before the line is looked for, the colour living on these two halves rather than on the box. */}
                      <div
                        className="pointer-events-none absolute inset-x-0 top-0 bg-emerald-500/80"
                        style={{ height: lineY }}
                      />
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 bg-emerald-500"
                        style={{ top: lineY }}
                      />
                      {/* The line itself, half the note's width and centred, inside a `VEL_PX` grab zone that takes the press (docs/clipEditors.md). */}
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

                      {/* The two STRETCH grips, boxes rather than a hit-test so the cursor says where the handle is, and LAST in the note (docs/clipEditors.md). */}
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
                            onPointerDown={(e) =>
                              onNotePointerDown(e, n, "end")
                            }
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
                  windowFrom={loop?.from ?? 0}
                  windowLength={loop?.win ?? 0}
                  ppb={ppb}
                  height={gridH}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
