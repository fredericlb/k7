// Minimap.tsx — the whole graph in a corner: every card as a block, the pane as a frame over them,
// and a press or a drag that moves the camera there. Drawn on a canvas off the camera REF and
// repainted by the graph's own paint, because the camera is not React state (docs/camera.md).
// Two buttons ride on top of it: back to the fitted view, and the host's organize. docs/minimap.md.

import { Maximize, Network } from "@frediverse/ui/icons";
import type { GraphNode } from "@studio/ui-chains/graph";
import { useCallback, useEffect, useRef } from "react";
import type { Cam } from "./camera";

/** The map's size in CSS px: small enough to leave the graph its corner, wide as a pane usually is. */
export const MAP_W = 180;
export const MAP_H = 120;
const PAD = 6;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** World → map: the whole drawing fitted, centred, aspect kept. */
export function projection(b: Box) {
  const bw = Math.max(1, b.width - b.left);
  const bh = Math.max(1, b.height - b.top);
  const s = Math.min((MAP_W - 2 * PAD) / bw, (MAP_H - 2 * PAD) / bh);
  const ox = (MAP_W - bw * s) / 2 - b.left * s;
  const oy = (MAP_H - bh * s) / 2 - b.top * s;
  return { s, ox, oy };
}

export function Minimap({
  nodes,
  bounds,
  cam,
  view,
  paintRef,
  onCenter,
  onFit,
  onOrganize,
}: {
  nodes: readonly GraphNode[];
  bounds: Box;
  /** The camera and the pane's size, READ at paint time — both change without a render. */
  cam: React.RefObject<Cam>;
  view: React.RefObject<{ w: number; h: number }>;
  /** Where the graph calls this map's paint from, on every camera move. */
  paintRef: React.MutableRefObject<() => void>;
  /** Put the pane's centre on this WORLD point, at the zoom it has. */
  onCenter: (x: number, y: number) => void;
  onFit: () => void;
  /** The host's auto-organize; the button exists only when given. */
  onOrganize?: () => void;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  // What was last drawn: a cable frame repaints the graph ~30 times a second, and the map need not follow it.
  const drawn = useRef<{
    cam: Cam;
    w: number;
    h: number;
    nodes: unknown;
  } | null>(null);

  const paint = useCallback(() => {
    const cv = cvRef.current;
    const c = cam.current;
    const v = view.current;
    if (!cv || !c || !v) return;
    const last = drawn.current;
    if (
      last &&
      last.nodes === nodes &&
      last.w === v.w &&
      last.h === v.h &&
      last.cam.x === c.x &&
      last.cam.y === c.y &&
      last.cam.k === c.k
    )
      return;
    drawn.current = { cam: { ...c }, w: v.w, h: v.h, nodes };
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== MAP_W * dpr) {
      cv.width = MAP_W * dpr;
      cv.height = MAP_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    const { s, ox, oy } = projection(bounds);
    for (const n of nodes) {
      // A lane in its own colour, the sums in the accent, everything else one quiet grey.
      ctx.fillStyle =
        n.kind === "track"
          ? (n.color ?? "#c8a06a")
          : n.kind === "sink"
            ? "#c8a06a"
            : "#5d5d68";
      ctx.fillRect(
        ox + n.x * s,
        oy + n.y * s,
        Math.max(1.5, n.w * s),
        Math.max(1.5, n.h * s),
      );
    }
    // The pane, in world units: what the camera shows is (screen − offset) / zoom.
    ctx.strokeStyle = "#e7e6ea";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      ox + (-c.x / c.k) * s + 0.5,
      oy + (-c.y / c.k) * s + 0.5,
      (v.w / c.k) * s,
      (v.h / c.k) * s,
    );
  }, [nodes, bounds, cam, view]);

  // Registered with the graph, and painted once now: a new graph moves no camera, so nothing else would.
  useEffect(() => {
    paintRef.current = paint;
    drawn.current = null;
    paint();
    return () => {
      paintRef.current = () => {};
    };
  }, [paint, paintRef]);

  const pressed = useRef(false);
  const center = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { s, ox, oy } = projection(bounds);
    onCenter((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s);
  };

  return (
    // Every gesture stops here: a press on the map is not a pan, a double-click on it is not "back".
    <div
      className="dgx-minimap"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dgx-minimap-bar">
        <button
          type="button"
          onClick={onFit}
          title="Zoom fit — frame the whole graph"
          aria-label="Zoom fit"
        >
          <Maximize />
        </button>
        {onOrganize && (
          <button
            type="button"
            onClick={onOrganize}
            title="Organize — lay the graph out again (graph organize)"
            aria-label="Organize"
          >
            <Network />
          </button>
        )}
      </div>
      <canvas
        ref={cvRef}
        style={{ width: MAP_W, height: MAP_H }}
        onPointerDown={(e) => {
          pressed.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          center(e);
        }}
        onPointerMove={(e) => {
          if (pressed.current) center(e);
        }}
        onPointerUp={() => {
          pressed.current = false;
        }}
        onPointerCancel={() => {
          pressed.current = false;
        }}
      />
    </div>
  );
}
