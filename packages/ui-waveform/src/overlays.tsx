// overlays.tsx — the waveform's grab handles over the canvas: the source window's two edges, the
// stretch points' targets, and the marker pins. Each follows its own drag from state the canvas
// also draws from, so the drag state stays the Waveform's and is handed in. See docs/marks.md.

import { Flag } from "@frediverse/ui/icons";
import type { Marker } from "./types";

/** The canvas's time axis: what every handle needs to turn a second into a position and back. */
interface Axis {
  width: number;
  height: number;
  total: number;
  timeToX: (t: number) => number;
  xToTime: (x: number) => number;
  localX: (clientX: number) => number;
}

export type WindowDrag = { edge: "from" | "to"; from: number; to: number };
export type WarpDrag = { orig: number; target: number };
export type MarkerDrag = { id: string; atSec: number; moved: boolean };

export function WindowEdges({
  edges,
  drag,
  setDrag,
  onMove,
  width,
  height,
  total,
  timeToX,
  xToTime,
  localX,
}: Axis & {
  edges: { from: number; to: number };
  drag: WindowDrag | null;
  setDrag: (d: WindowDrag | null) => void;
  onMove: (w: { from: number; to: number }) => void;
}) {
  return (["from", "to"] as const).map((edge) => {
    const at = edges[edge];
    return (
      <button
        key={edge}
        type="button"
        className="waveform-edge"
        // CLAMPED into the strip, unlike the pins below, with the true second in the title — see docs/marks.md.
        style={{
          left: Math.max(0, Math.min(width, timeToX(at))),
          height: height,
        }}
        title={`Drag to set the event's ${edge} (${at.toFixed(3)}s)`}
        aria-label={`window ${edge}`}
        onPointerDown={(e) => {
          e.stopPropagation(); // …or the canvas starts a selection under the same finger
          e.currentTarget.setPointerCapture(e.pointerId);
          // `edge` AFTER the spread: `edges` may itself be a drag in flight, carrying its own.
          setDrag({ ...edges, edge });
        }}
        onPointerMove={(e) => {
          if (drag?.edge !== edge) return;
          // Clamped to the FILE and kept a hair apart, since a window that crossed itself plays nothing.
          const sec = Math.max(0, Math.min(total, xToTime(localX(e.clientX))));
          setDrag(
            edge === "from"
              ? { ...drag, from: Math.min(sec, drag.to - 0.001) }
              : { ...drag, to: Math.max(sec, drag.from + 0.001) },
          );
        }}
        onPointerUp={() => {
          const d = drag;
          setDrag(null);
          if (d?.edge === edge) onMove({ from: d.from, to: d.to });
        }}
        onPointerCancel={() => setDrag(null)}
      />
    );
  });
}

export function WarpHandles({
  warps,
  drag,
  setDrag,
  onMove,
  onMenu,
  width,
  height,
  total,
  timeToX,
  xToTime,
  localX,
}: Axis & {
  warps: { orig: number; target: number }[];
  drag: WarpDrag | null;
  setDrag: (d: WarpDrag | null) => void;
  onMove: (mark: { orig: number; target: number }, toSec: number) => void;
  onMenu?: (
    mark: { orig: number; target: number },
    x: number,
    y: number,
  ) => void;
}) {
  return warps.map((w) => {
    const held = drag && Math.abs(drag.orig - w.orig) < 1e-9 ? drag : null;
    const at = held ? held.target : w.target;
    return (
      <button
        key={`warp-${w.orig}`}
        type="button"
        className="waveform-edge"
        style={{
          left: Math.max(0, Math.min(width, timeToX(at))),
          height: height,
        }}
        title={`Drag to move where ${w.orig.toFixed(3)}s lands (${at.toFixed(3)}s) — right-click for more`}
        aria-label="stretch point"
        // The host's menu and not the browser's, but only when it offers one.
        onContextMenu={
          onMenu
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onMenu(
                  { orig: w.orig, target: w.target },
                  e.clientX,
                  e.clientY,
                );
              }
            : undefined
        }
        onPointerDown={(e) => {
          e.stopPropagation(); // …or the canvas starts a selection under the same finger
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ orig: w.orig, target: w.target });
        }}
        onPointerMove={(e) => {
          if (!held) return;
          // NOT snapped, unlike every other click on this canvas, and that is the point of a warp.
          setDrag({
            orig: w.orig,
            target: Math.max(0, Math.min(total, xToTime(localX(e.clientX)))),
          });
        }}
        onPointerUp={() => {
          const d = drag;
          setDrag(null);
          if (d && Math.abs(d.orig - w.orig) < 1e-9)
            onMove({ orig: w.orig, target: w.target }, d.target);
        }}
        onPointerCancel={() => setDrag(null)}
      />
    );
  });
}

export function MarkerPins({
  markers,
  place,
  drag,
  setDrag,
  onMove,
  onClick,
  onSeek,
  total,
  timeToX,
  xToTime,
  localX,
}: Omit<Axis, "width" | "height"> & {
  markers: Marker[];
  place?: "top" | "low";
  drag: MarkerDrag | null;
  setDrag: (d: MarkerDrag | null) => void;
  onMove?: (m: Marker, atSec: number) => void;
  onClick?: (m: Marker) => void;
  onSeek?: (t: number) => void;
}) {
  return markers.map((m) => (
    <button
      key={m.id}
      type="button"
      className={
        place === "low"
          ? "waveform-marker waveform-marker--low"
          : "waveform-marker"
      }
      // The pin follows the pointer from LOCAL state while dragged, or it would lag the hand by a save.
      style={{
        left: timeToX(drag?.id === m.id ? drag.atSec : m.atSec),
      }}
      title={
        onMove ? (m.comment ?? "Marker — drag to move") : m.comment || "Marker"
      }
      onPointerDown={(e) => {
        if (!onMove) return;
        e.stopPropagation(); // …or the canvas underneath starts a selection at the same time
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ id: m.id, atSec: m.atSec, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag || drag.id !== m.id) return;
        const x = localX(e.clientX);
        setDrag({
          id: m.id,
          atSec: Math.max(0, Math.min(total, xToTime(x))),
          // 4px, the same threshold the canvas uses to tell a click from a drag.
          moved: drag.moved || Math.abs(x - timeToX(m.atSec)) > 4,
        });
      }}
      onPointerUp={() => {
        const d = drag;
        setDrag(null);
        if (!d || d.id !== m.id) return;
        if (d.moved) onMove?.(m, d.atSec);
        else if (onClick) onClick(m);
        else onSeek?.(m.atSec);
      }}
      onPointerCancel={() => setDrag(null)}
      // Click still answers for a host that offers no move; a drag that handled the release never reaches it.
      onClick={() => {
        if (onMove) return;
        if (onClick) onClick(m);
        else onSeek?.(m.atSec);
      }}
    >
      <Flag className="waveform-marker-flag" />
    </button>
  ));
}
