// RollNoteBox.tsx — one note of the piano roll: its box, the velocity line and its grab zone, the two
// stretch grips; and the hover bands the grid lays under the notes. The one thing a reader would get
// wrong: a NoteBox is memoised, so every prop must be stable for a note nobody touches — the
// handlers come through `RollNoteHandlers`, which the roll keeps stable (../../docs/clipEditors.md).

import { cn } from "@frediverse/ui/lib/utils";
import type React from "react";
import { memo } from "react";
import { type RollHoverStore, useHoverCell } from "../hooks/useRollHover";
import { noteName } from "../noteNames";
import type { RollNote } from "../rollPending";

/** What a note's elements call — stable for the roll's life, reading the gestures' latest closures. */
export interface RollNoteHandlers {
  down: (
    e: React.PointerEvent,
    n: RollNote,
    grip?: "line" | "start" | "end",
  ) => void;
  menu: (e: React.MouseEvent, n: RollNote) => void;
  move: (e: React.PointerEvent, top: number) => void;
  end: () => void;
}

/** What the note can be asked: which of the edit callbacks the roll was given. */
export interface RollNoteCaps {
  vel: boolean;
  range: boolean;
  pitch: boolean;
}

export const RollNoteBox = memo(function RollNoteBox({
  n,
  plays,
  vel,
  at,
  dragMode,
  rowH,
  ppb,
  origin,
  caps,
  edgePx,
  velPx,
  on,
}: {
  n: RollNote;
  /** Whether it sounds in the event: one that does not is context, drawn dimmed and no target. */
  plays: boolean;
  /** What it is worth: the file's `vel`, or the velocity drag's live value. */
  vel: number;
  /** Where a drag draws it — null for a note not in hand. */
  at: { key: number; start: number; end: number } | null;
  /** The drag in hand's kind, for the cursor — null for a note not in hand. */
  dragMode: "move" | "start" | "end" | null;
  rowH: number;
  ppb: number;
  origin: number;
  caps: RollNoteCaps;
  edgePx: number;
  velPx: number;
  on: RollNoteHandlers;
}) {
  const h = Math.max(1, rowH - 1);
  const dragging = dragMode !== null;
  // Where the velocity sits in the note: 0 at its bottom edge, 1 at its top.
  const lineY = (1 - vel) * (h - 1);
  const drawStart = at ? at.start : n.time;
  const drawDur = at ? at.end - at.start : n.duration;
  // The row the note is DRAWN on, which a vertical drag moves; the velocity gesture never runs at the same time.
  const top = (127 - (at ? at.key : n.key)) * rowH;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a note is dragged by the pointer; the keyboard edits it through the caret
    <div
      title={
        plays
          ? `${noteName(n.key)} · ${n.time}–${n.time + n.duration}b · vel ${+vel.toFixed(2)}${
              caps.vel ? " — drag the white line for velocity" : ""
            }${
              caps.range
                ? `, the body to move${caps.pitch ? " (up or down to transpose)" : ""}, either edge to stretch`
                : ""
            }`
          : `${noteName(n.key)} · ${n.time}–${n.time + n.duration}b — outside this event's window`
      }
      onPointerDown={plays ? (e) => on.down(e, n) : undefined}
      onContextMenu={plays ? (e) => on.menu(e, n) : undefined}
      onPointerMove={plays ? (e) => on.move(e, top) : undefined}
      onPointerUp={plays ? on.end : undefined}
      onLostPointerCapture={plays ? on.end : undefined}
      className={cn(
        "absolute overflow-hidden rounded-[1px] touch-none",
        !plays && "pointer-events-none opacity-30",
        plays && (caps.range ? "cursor-grab" : caps.vel && "cursor-ns-resize"),
        // A move outranks the velocity cursor while one is happening: the pointer says which gesture it is IN.
        dragging &&
          (dragMode === "move" ? "cursor-grabbing" : "cursor-ew-resize"),
      )}
      style={{
        top,
        height: h,
        // The note follows the hand while it is being dragged — a picture, not an edit; nothing is committed until release.
        left: ((dragging ? drawStart : n.time) - origin) * ppb,
        width: Math.max(
          2,
          (dragging ? drawDur : n.duration > 0 ? n.duration : 0.25) * ppb,
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
      {/* The line itself, half the note's width and centred, inside a `velPx` grab zone that takes the press (docs/clipEditors.md). */}
      {h >= 4 && (
        <div
          onPointerDown={(e) => on.down(e, n, "line")}
          onPointerMove={(e) => on.move(e, top)}
          onPointerUp={on.end}
          onLostPointerCapture={on.end}
          className={cn(
            "absolute left-1/4 w-1/2",
            caps.vel && "cursor-ns-resize",
          )}
          style={{ top: lineY - velPx, height: 2 * velPx + 1 }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 h-px bg-white"
            style={{ top: velPx }}
          />
        </div>
      )}

      {/* The two STRETCH grips, boxes rather than a hit-test so the cursor says where the handle is, and LAST in the note (docs/clipEditors.md). */}
      {caps.range && plays && (
        <>
          <div
            onPointerDown={(e) => on.down(e, n, "start")}
            onPointerMove={(e) => on.move(e, top)}
            onPointerUp={on.end}
            onLostPointerCapture={on.end}
            className="absolute inset-y-0 left-0 cursor-ew-resize"
            style={{ width: edgePx }}
          />
          <div
            onPointerDown={(e) => on.down(e, n, "end")}
            onPointerMove={(e) => on.move(e, top)}
            onPointerUp={on.end}
            onLostPointerCapture={on.end}
            className="absolute inset-y-0 right-0 cursor-ew-resize"
            style={{ width: edgePx }}
          />
        </>
      )}
    </div>
  );
});

/** The row and the column under the pointer, faint and under everything drawn on the grid: where a click lands. */
export function RollHoverBands({
  store,
  rowH,
  colLeft,
  colW,
}: {
  store: RollHoverStore;
  rowH: number;
  colLeft: (col: number) => number;
  colW: number;
}) {
  const hover = useHoverCell(store);
  if (!hover) return null;
  return (
    <>
      <div
        className="pointer-events-none absolute left-0 right-0 bg-foreground/[0.05]"
        style={{ top: hover.row * rowH, height: Math.max(1, rowH) }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 bg-foreground/[0.05]"
        style={{ left: colLeft(hover.col), width: Math.max(1, colW) }}
      />
    </>
  );
}
