// useRollGestures.ts — what a pointer on the piano roll DOES: draw a note on the lane, drag a
// note's velocity line, move or stretch it by its body and edges, drag a whole selection, and the
// right-click menu. PianoRoll draws the notes and the ghosts this hands back; the arithmetic each
// gesture writes is ../rollDrag.ts. See ../../docs/clipEditors.md.

import { usePointerFollow } from "@studio/ui-timeline/drag";
import { type RefObject, useRef, useState } from "react";
import { clamp } from "../clamp";
import type { MenuCtx } from "../contextMenu";
import { selBox } from "../gridCaret";
import { m } from "../paraglide/messages.js";
import {
  dragMoved,
  drawSpan,
  type GroupNote,
  keyOffset,
  movesPitch,
  planGroupMove,
  type RollDrag,
  tSpan,
  velAt,
} from "../rollDrag";
import { laneDraws, type RollMode } from "../rollMode";
import { noteAddr, type RollNote } from "../rollPending";
import { freeSnap, snapMode, snapPosition } from "../snap";
import type { GridCaret } from "./useGridCaret";

/** The roll's scale and grid, as the gestures read a pointer through them. */
export interface RollGeometry {
  origin: number;
  canvasBeats: number;
  rowH: number;
  ppb: number;
  gridUnit: number;
  beatOfCol: (col: number) => number;
  colOfBeat: (beat: number) => number;
}

/** What the gestures may write — each absent one is a gesture this roll does not offer (PianoRoll's props). */
export interface RollEdits {
  onCreateNote?: (
    key: number,
    startBeat: number,
    endBeat: number,
  ) => void | Promise<void>;
  onSetVelocity?: (
    key: number,
    startBeat: number,
    vel: number,
  ) => void | Promise<void>;
  onSetNoteRange?: (
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void | Promise<void>;
  onMoveNote?: (
    key: number,
    startBeat: number,
    newKey: number,
    newStart: number,
  ) => void | Promise<void>;
  onMoveNotes?: (
    moves: [number, number, number, number][],
  ) => void | Promise<void>;
  onRemoveNote?: (key: number, startBeat: number) => void | Promise<void>;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  onPreviewNote?: (key: number, vel: number) => void;
}

export function useRollGestures({
  mode,
  grid,
  laneRef,
  notes,
  notePlays,
  inAct,
  docNote,
  noteDur,
  seqId,
  geo,
  edits,
  commit,
  paint,
  inFlight,
  setStatus,
}: {
  mode: RollMode;
  grid: GridCaret;
  laneRef: RefObject<HTMLDivElement | null>;
  /** The notes as the roll reads them NOW, ghosts included. */
  notes: RollNote[];
  notePlays: (n: { time: number; duration: number }) => boolean;
  inAct: (beat: number) => boolean;
  docNote: (key: number, time: number) => RollNote | undefined;
  noteDur: (key: number, time: number) => number;
  seqId: string;
  geo: RollGeometry;
  edits: RollEdits;
  /** Ghost one edit at `addr` and run its command, as PianoRoll does for every single-note write (rollPending.ts). */
  commit: (
    addr: string,
    to: RollNote | null,
    run: () => void | Promise<void>,
  ) => void;
  paint: (edits: [string, RollNote | null][]) => void;
  inFlight: RefObject<number>;
  setStatus?: (s: string) => void;
}) {
  const { origin, canvasBeats, rowH, ppb, gridUnit, beatOfCol, colOfBeat } =
    geo;
  const {
    onCreateNote,
    onSetVelocity,
    onSetNoteRange,
    onMoveNote,
    onMoveNotes,
    onRemoveNote,
    onContextMenu,
    onPreviewNote,
  } = edits;
  const { caret } = grid;

  // --- left-click-drag to draw a note ----------------------------------------------

  // A live draft while dragging: pitch fixed at the press row, time from press to cursor.
  const [draft, setDraft] = useState<{
    k: number;
    t0: number;
    t1: number;
  } | null>(null);
  const drag = useRef<{ k: number; t0: number } | null>(null);
  // One pointer per gesture, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();

  /** The step a gesture moves in: the grid the roll is drawing, or none while Ctrl is held (packages/ui-timeline/docs/ticks.md). */
  const stepAt = (e: PointerEvent | React.PointerEvent): number =>
    freeSnap(e) ? 0 : gridUnit;

  const atEvent = (e: PointerEvent | React.PointerEvent) => {
    const r = laneRef.current!.getBoundingClientRect();
    // Lane x → an ABSOLUTE beat: the lane's left edge is the origin, and a windowed clip cannot be pointed outside its window.
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

  /** The span a draw gesture covers, in beats — the cells it crossed, `gridUnit` being what a Ctrl-freed click is worth (rollDrag.ts). */
  const drawnSpan = (a: number, b: number, step: number) =>
    drawSpan(a, b, step, origin, gridUnit);

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // left only; middle pans
    /** The RECTANGLE: what `select` means, and what SHIFT means in EVERY mode — before the draw branch, so shift never draws. */
    if (e.shiftKey || !laneDraws(mode)) {
      e.preventDefault();
      grid.placeCaret(cellAtEvent(e));
      const feed = grid.beginDrag(cellAtEvent(e));
      // The rectangle stays as drawn whichever way the gesture ends.
      follow(e, { move: (ev) => feed(cellAtEvent(ev)) });
      return;
    }
    // A press is where you are: the caret follows it, before the draw and whether or not the roll can write.
    grid.placeCaret(cellAtEvent(e));
    if (!onCreateNote) return;
    e.preventDefault();
    // The RAW beat is remembered and the grid applied where the span is read, so Ctrl mid-drag changes the whole answer.
    const { beat, key } = atEvent(e);
    // Outside the event's window a new note would not sound, so it is refused rather than clamped; the caret still moved.
    if (!inAct(beat)) return;
    drag.current = { k: key, t0: beat };
    // Heard on the PRESS, before anything is written: the ear is what tells C# from D, and a drag has not chosen a length yet.
    onPreviewNote?.(key, 1);
    setDraft({ k: key, t0: beat, t1: beat });
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const { from, to } = drawnSpan(d.t0, atEvent(ev).beat, stepAt(ev));
      setDraft({ k: d.k, t0: from, t1: to });
    };
    const up = (ev: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      setDraft(null);
      if (!d) return;
      // A press that never left its cell covers that CELL: the command's own default is a whole beat, sixteen of them on a 1/16 grid.
      const { from, to } = drawnSpan(d.t0, atEvent(ev).beat, stepAt(ev));
      commit(
        noteAddr(d.k, from),
        { key: d.k, time: from, duration: to - from },
        () => onCreateNote(d.k, from, to),
      );
    };
    // A cancelled draw drops its draft and writes no note.
    const cancel = () => {
      drag.current = null;
      setDraft(null);
    };
    follow(e, { move, end: up, cancel });
  };

  /** --- drag a note's VELOCITY: the WHITE LINE is the handle, 0 at the bottom edge and 1 at the top, taken with pointer CAPTURE. */
  interface VDrag {
    key: number;
    time: number;
    vel: number;
    moved: boolean;
  }

  /** --- drag a note's TIME RANGE and its PITCH: four grips, each a PLACE rather than a direction (rollDrag.ts holds the arithmetic). */
  const EDGE_PX = 6;
  /** How far either side of the white line still counts as holding it — a line is one pixel and nobody can hit one. */
  const VEL_PX = 5;
  const [tDraw, setTDraw] = useState<RollDrag | null>(null);
  const tDrag = useRef<RollDrag | null>(null);
  // Which gesture this press became, once it has travelled far enough to say — a ref, since a state updater runs twice under StrictMode.
  const gesture = useRef<"vel" | "time" | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  // The ref is the LIVE one and the state only what to draw; the commit reads the ref, for the StrictMode reason above.
  const [vDraw, setVDraw] = useState<VDrag | null>(null);
  const vDrag = useRef<VDrag | null>(null);

  /** The pointer's velocity, once its Y is expressed inside the note's own row (the scale itself is rollDrag.ts's). */
  const velOf = (clientY: number, top: number): number => {
    const el = laneRef.current;
    if (!el) return 1;
    return velAt(clientY - el.getBoundingClientRect().top - top, rowH);
  };

  /** Is this note IN the rectangle — it STARTS inside, the rule `copyNotes` applies — so the menu and the drag cannot disagree. */
  const boxHolds = (
    b: { rowLo: number; rowHi: number; colLo: number; colHi: number },
    n: { key: number; time: number },
  ) =>
    n.key >= 127 - b.rowHi &&
    n.key <= 127 - b.rowLo &&
    n.time >= beatOfCol(b.colLo) - 1e-9 &&
    n.time < beatOfCol(b.colHi + 1) - 1e-9;

  /** A body drag on a note INSIDE the rectangle moves everything it holds: those notes, and the ones that stay, read at the press. */
  const [groupDraw, setGroupDraw] = useState<GroupNote[] | null>(null);
  const groupRef = useRef<{ group: GroupNote[]; others: GroupNote[] } | null>(
    null,
  );

  /** Right-click on a note: its own two verbs, through the shell's menu. The CARET is where a split would cut, not the pointer. */
  const onNoteMenu = (
    e: React.MouseEvent,
    n: { key: number; time: number; duration: number },
  ) => {
    if (!onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const b = grid.sel ? selBox(grid.sel) : null;
    onContextMenu(
      {
        kind: "note",
        sequence: seqId,
        note: n.key,
        start: n.time,
        end: n.time + n.duration,
        at: beatOfCol(caret.col),
        // The rectangle, only when this note is IN it: the four plural verbs must not act on a box the click was outside of.
        ...(b && boxHolds(b, n)
          ? {
              region: {
                lo: 127 - b.rowHi,
                hi: 127 - b.rowLo,
                from: beatOfCol(b.colLo),
                to: beatOfCol(b.colHi + 1),
              },
            }
          : {}),
      },
      e.clientX,
      e.clientY,
    );
  };

  /** A press on a note, and `grip` says WHICH of its four it landed on — named by the element that took it, not hit-tested. */
  const onNotePointerDown = (
    e: React.PointerEvent,
    n: { key: number; time: number; duration: number; vel?: number },
    grip?: "line" | "start" | "end",
  ) => {
    if (e.button !== 0) return;
    // In CREATE a note is no target — the press is let through to the LANE, so this returns before `stopPropagation`.
    if (mode === "create") return;
    e.preventDefault();
    e.stopPropagation(); // not a new note: this press belongs to the one already here
    // REMOVE takes the note and asks nothing else of the press — no grip, no capture, no drag to arm.
    if (mode === "remove") {
      if (onRemoveNote)
        commit(noteAddr(n.key, n.time), null, () =>
          onRemoveNote(n.key, n.time),
        );
      return;
    }
    if (!onSetVelocity && !onSetNoteRange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    // Claimed on the PRESS: a grip is a place, not a direction, so none of them waits to see which way the hand goes.
    const t: RollDrag = {
      key: n.key,
      time: n.time,
      dur: n.duration,
      mode: grip === "start" || grip === "end" ? grip : "move",
      dBeats: 0,
      dKeys: 0,
    };
    tDrag.current = t;
    const v = { key: n.key, time: n.time, vel: n.vel ?? 1, moved: false };
    vDrag.current = v;
    // A press on a note plays it, at what it is WORTH — which is how a velocity drag is judged by ear rather than by the line's height.
    onPreviewNote?.(n.key, v.vel);
    // The line sets, an edge stretches, the body moves — and a note with nowhere to move keeps its body as the velocity handle.
    gesture.current =
      grip === "line" && onSetVelocity
        ? "vel"
        : onSetNoteRange
          ? "time"
          : onSetVelocity
            ? "vel"
            : null;
    if (gesture.current === "time") setTDraw(t);
    // The BODY of a note in the rectangle: the whole selection travels with it, and the single-note verbs stand aside.
    const b = grid.sel ? selBox(grid.sel) : null;
    if (
      gesture.current === "time" &&
      t.mode === "move" &&
      onMoveNotes &&
      b &&
      boxHolds(b, n)
    ) {
      const playing = notes.filter(notePlays);
      const group = playing.filter((x) => boxHolds(b, x));
      groupRef.current = {
        group,
        others: notes.filter((x) => !group.includes(x)),
      };
      setGroupDraw(group);
    }
  };

  const onNotePointerMove = (e: React.PointerEvent, top: number) => {
    if (!gesture.current) return;
    const from = pressAt.current;
    if (gesture.current === "vel") {
      const d = vDrag.current;
      if (!d) return;
      // A press that has not travelled is a CLICK on the line, and a click must write nothing — 4px, the waveform's own threshold.
      if (
        !d.moved &&
        from &&
        Math.abs(e.clientX - from.x) < 4 &&
        Math.abs(e.clientY - from.y) < 4
      )
        return;
      const next = { ...d, vel: velOf(e.clientY, top), moved: true };
      vDrag.current = next;
      setVDraw(next);
      return;
    }
    const d = tDrag.current;
    if (!d || !from) return;
    // The timeline's keys, read live: nothing lands on the grid, Ctrl moves by whole steps, Shift frees it (snap.ts).
    const anchor = d.mode === "end" ? d.time + d.dur : d.time;
    const raw = (e.clientX - from.x) / Math.max(1, ppb);
    const next: RollDrag = {
      ...d,
      dBeats: snapPosition(anchor, raw, gridUnit, snapMode(e)) - anchor,
      // No modifier reaches this axis: a row IS a semitone, and there is nothing between two of them to free.
      dKeys:
        (onMoveNote || groupRef.current) && d.mode === "move"
          ? keyOffset(e.clientY - from.y, rowH)
          : 0,
    };
    // Each ROW crossed is heard as it is crossed: a transposition judged by eye against a 128-lane grid is not judged.
    if (next.dKeys !== d.dKeys) onPreviewNote?.(tSpan(next).key, 1);
    tDrag.current = next;
    setTDraw(next);
  };

  const endVDrag = () => {
    const g = gesture.current;
    const v = vDrag.current;
    const t = tDrag.current;
    gesture.current = null;
    vDrag.current = null;
    tDrag.current = null;
    pressAt.current = null;
    const held = groupRef.current;
    groupRef.current = null;
    setVDraw(null);
    setTDraw(null);
    setGroupDraw(null);
    // A dragged SELECTION: one command for every note, each painted where it lands, the rectangle following.
    if (g === "time" && t && held && onMoveNotes) {
      const plan = planGroupMove(held.group, held.others, t.dBeats, t.dKeys);
      if ("refused" in plan) {
        if (plan.refused === "occupied") setStatus?.(m["roll.moveOccupied"]());
        return;
      }
      paint(
        held.group.map((n) => [
          noteAddr(n.key, n.time),
          { ...n, key: n.key + plan.dKeys, time: n.time + plan.dBeats },
        ]),
      );
      inFlight.current++;
      void Promise.resolve(onMoveNotes(plan.moves)).finally(() => {
        inFlight.current--;
      });
      grid.shiftSelect(-plan.dKeys, Math.round(plan.dBeats / gridUnit));
      const count = plan.moves.length;
      setStatus?.(m["roll.moved"]({ n: count, s: count > 1 ? "s" : "" }));
      return;
    }
    if (g === "vel" && v?.moved && onSetVelocity)
      commit(
        noteAddr(v.key, v.time),
        {
          key: v.key,
          time: v.time,
          duration: noteDur(v.key, v.time),
          vel: v.vel,
        },
        () => onSetVelocity(v.key, v.time, v.vel),
      );
    if (g === "time" && t && dragMoved(t)) {
      const { key, start, end } = tSpan(t);
      const addr = noteAddr(t.key, t.time);
      const was = docNote(t.key, t.time);
      // A changed PITCH is `sequence note move`, anything else the two-grip range verb — and not one verb for both (docs/clipEditors.md).
      if (movesPitch(t) && onMoveNote)
        commit(
          addr,
          {
            key,
            time: start,
            duration: t.dur,
            ...(was?.vel === undefined ? {} : { vel: was.vel }),
          },
          () => onMoveNote(t.key, t.time, key, start),
        );
      else if (onSetNoteRange)
        commit(
          addr,
          {
            key: t.key,
            time: start,
            duration: end - start,
            ...(was?.vel === undefined ? {} : { vel: was.vel }),
          },
          () => onSetNoteRange(t.key, t.time, start, end),
        );
    }
  };

  return {
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
  };
}
