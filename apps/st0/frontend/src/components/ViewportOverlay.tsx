// ViewportOverlay.tsx — the selection box over the composited frame: click a layer to select it,
// drag its body to move it, drag a handle to resize it. HTML over the GL canvas, the way the
// chains graph draws HTML nodes over its cable canvas — a GL hit test would be a second copy of
// geometry the document already states. The arithmetic is viewportRect.ts.
// See ../../docs/picture.md.

import { cn } from "@frediverse/ui/lib/utils";
import type { WebVideoTrack } from "@studio/web-protocol";
import { useEffect, useRef, useState } from "react";
import {
  CURSOR,
  dragRect,
  GRIP_TOL,
  type Grip,
  gripAt,
  HANDLE_AT,
  HANDLES,
  hitLayer,
  layerBelow,
  type PickLayer,
  type Rect,
  sameRect,
} from "../viewportRect";

const rectOf = (t: WebVideoTrack): Rect => ({ x: t.x, y: t.y, w: t.w, h: t.h });

export function ViewportOverlay({
  tracks,
  viewport,
  box,
  selected,
  onSelect,
  onRect,
  readOnly,
}: {
  /** The picture lanes, BOTTOM FIRST as the compile hands them over — the last is the one in front. */
  tracks: readonly WebVideoTrack[];
  viewport: readonly [number, number];
  /** The canvas's CSS size, from VideoCanvas's own letterboxing — null until it has measured. */
  box: { w: number; h: number } | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A finished drag: the lane's new rect in viewport px. Absent ⇒ the frame is read-only. */
  onRect?: (lane: string, rect: Rect) => void;
  readOnly?: boolean;
}) {
  // The live rect while a drag runs, and what it started from — the ghost the commit then makes true.
  const [drag, setDrag] = useState<{
    lane: string;
    grip: Grip;
    from: Rect;
    now: Rect;
  } | null>(null);
  const [hover, setHover] = useState<Grip | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Where the press landed, in viewport px — every frame of the drag is measured from it.
  const down = useRef({ x: 0, y: 0 });

  // A lane DRAWING shapes has no rect worth grabbing — each shape carries its own geometry.
  const pickable = tracks.filter((t) => !t.shapes.length);
  const scale = box && viewport[0] ? box.w / viewport[0] : 0;
  const sel = pickable.find((t) => t.id === selected) ?? null;
  // The selected lane's rect: the drag's while one runs, so the box follows the pointer rather than the file.
  const selRect = sel ? (drag?.lane === sel.id ? drag.now : rectOf(sel)) : null;

  // Escape drops the selection, on the rung below the shell's fullscreen — the same ladder the timeline keeps.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dragRef.current) return;
      e.stopPropagation();
      onSelect(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected, onSelect]);

  if (!box || !scale) return null;

  /** A pointer event in VIEWPORT px — the one conversion, so nothing downstream knows about CSS. */
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const pick: PickLayer[] = pickable.map((t) => ({
    id: t.id,
    rect: rectOf(t),
    hidden: t.mute,
  }));
  // The tolerance is in VIEWPORT px, so the grip stays the same size on screen however the pane is scaled.
  const tol = GRIP_TOL / scale;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    // The SELECTED layer's grips answer first: a handle sticking out over another layer is still its handle.
    const grip = selRect ? gripAt(selRect, p.x, p.y, tol) : null;
    if (sel && grip && onRect && !readOnly) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({
        lane: sel.id,
        grip,
        from: selRect as Rect,
        now: selRect as Rect,
      });
      return;
    }
    // Alt cycles DOWN the stack: with two full-frame lanes, the one behind is otherwise unreachable.
    const id = e.altKey
      ? layerBelow(pick, p.x, p.y, selected)
      : hitLayer(pick, p.x, p.y);
    onSelect(id);
    // A press that selects also starts the move, so putting a layer somewhere is one gesture and not two.
    const hit = id ? pick.find((l) => l.id === id) : null;
    if (hit && onRect && !readOnly) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ lane: hit.id, grip: "body", from: hit.rect, now: hit.rect });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const p = at(e);
    if (!d) {
      setHover(selRect ? gripAt(selRect, p.x, p.y, tol) : null);
      return;
    }
    // Measured from the PRESS and from the rect it started on, never frame to frame: a re-applied
    // offset makes the edge run away from the cursor, which the timeline's drags pay for once each.
    setDrag({
      ...d,
      now: dragRect(d.from, d.grip, p.x - down.current.x, p.y - down.current.y),
    });
  };

  const onUp = () => {
    const d = dragRef.current;
    setDrag(null);
    setHover(null);
    if (d && onRect && !sameRect(d.from, d.now)) onRect(d.lane, d.now);
  };

  const px = (n: number) => n * scale;
  const cursor = drag ? CURSOR[drag.grip] : hover ? CURSOR[hover] : "default";

  return (
    <div
      // Absolute, so the canvas the driver appended keeps the host's centring to itself.
      className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2"
      style={{ width: box.w, height: box.h, cursor }}
      onPointerDown={(e) => {
        down.current = at(e);
        onDown(e);
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {selRect && (
        <div
          className={cn(
            "pointer-events-none absolute outline outline-1 -outline-offset-1",
            drag ? "outline-primary" : "outline-primary/80",
          )}
          style={{
            left: px(selRect.x),
            top: px(selRect.y),
            width: px(selRect.w),
            height: px(selRect.h),
          }}
        >
          {/* The eight grips, drawn only when the frame can be written: a snapshot shows the box and no handles. */}
          {onRect &&
            !readOnly &&
            HANDLES.map((g) => {
              const [fx, fy] = HANDLE_AT[g];
              return (
                <span
                  key={g}
                  className="-translate-x-1/2 -translate-y-1/2 absolute size-2 border border-primary bg-background"
                  style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
                />
              );
            })}
        </div>
      )}
      {/* What is selected, and how big it is — the one readout a drag needs, and it moves with the box. */}
      {sel && selRect && (
        <span
          className="pointer-events-none absolute rounded-sm bg-background/80 px-1 font-mono text-[10px] text-foreground"
          style={{
            left: px(selRect.x),
            top: Math.max(0, px(selRect.y) - 14),
          }}
        >
          {sel.name || sel.id} · {selRect.w}×{selRect.h} @ {selRect.x},
          {selRect.y}
        </span>
      )}
    </div>
  );
}
