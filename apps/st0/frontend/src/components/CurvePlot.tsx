// CurvePlot.tsx — the curve editor's picture: the curve as it will play, over its bars (or, for an
// envelope, over its own length), and for a DRAWN curve the points themselves — click to add one,
// drag to move it, double-click to take it out. A point sits where the curve passes, so it is placed
// through the inverse of the amplitude and polarity. See docs/curveEditor.md.

import { pointBeats } from "@studio/song-schema/curveMath";
import { useRef } from "react";
import {
  type CurveDraft,
  isDrawnShape,
  plotSpan,
  pointAt,
  previewGrid,
  previewLines,
  withPoint,
} from "../curveDraft";

const W = 480;
const H = 160;
const PAD = 8;
const R = 5;

export function CurvePlot({
  draft,
  num,
  den,
  onPoints,
}: {
  draft: CurveDraft;
  num: number;
  den: number;
  onPoints: (points: CurveDraft["points"]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | null>(null);
  // An on/off curve is unipolar at full height whatever the draft held for the other shapes.
  const binary = draft.shape === "onoff";
  const bipolar = !binary && draft.polarity === "bipolar";
  const amplitude = binary ? 1 : draft.amplitude;
  // Always -1..1, so the two bounds are lines on the plot and a cut or a polarity is seen against them.
  const lo = -1;
  // A near-silent amplitude still leaves the points somewhere to grab.
  const amp = Math.max(amplitude, 0.05);
  const yOf = (out: number) =>
    PAD + (1 - (out - lo) / (1 - lo)) * (H - PAD * 2);
  const xOf = (x: number) => PAD + x * (W - PAD * 2);
  const custom = isDrawnShape(draft.shape);
  const { beats: spanBeats } = plotSpan(draft, num, den);
  // The solid curve, and past it an endless oscillator's next cycle, faded — split as the graph's card splits it.
  const parts = previewLines(draft, num, den);
  const toLine = (ps: { x: number; y: number }[]) =>
    ps.map((p) => `${xOf(p.x)},${yOf(p.y)}`).join(" ");
  const line = toLine(parts.solid);
  const faded = toLine(parts.faded);
  // One line per metrical beat, a bar every `num` of them; a span need not be whole bars.
  const grid = previewGrid(draft, num, den);

  // Plot coordinates → a point: x across the span, the output inverted back to the unit value a file holds.
  const pointFrom = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const fx = Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2)));
    const out = lo + (1 - (y - PAD) / (H - PAD * 2)) * (1 - lo);
    const unit = bipolar ? (out / amp + 1) / 2 : out / amp;
    return pointAt(fx, unit, spanBeats, num, den, binary);
  };
  const place = (e: React.PointerEvent) => {
    const p = pointFrom(e);
    if (!p) return;
    onPoints(
      withPoint(draft.points, p, num, den, dragging.current ?? undefined),
    );
    dragging.current = p.time;
  };

  // Each point's beat in the draft's OWN order, so a circle and the point it moves are one index.
  const beats = custom
    ? draft.points.map((p) => pointBeats([p], num, den)[0])
    : [];
  const outOf = (unit: number) => (bipolar ? unit * 2 - 1 : unit) * amplitude;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full rounded border border-border bg-background ${custom ? "cursor-crosshair touch-none" : ""}`}
      onPointerDown={
        custom
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = null;
              place(e);
            }
          : undefined
      }
      onPointerMove={custom ? (e) => dragging.current && place(e) : undefined}
      onPointerUp={() => {
        dragging.current = null;
      }}
    >
      <title>
        {custom
          ? "The curve — click to add a point, drag to move one, double-click to remove it"
          : "The curve"}
      </title>
      {/* Every beat of a song-time curve, faint, and the bars over them; an envelope's own length has neither. */}
      {grid.map((b) => (
        <line
          key={b.x}
          x1={xOf(b.x)}
          x2={xOf(b.x)}
          y1={PAD}
          y2={H - PAD}
          className="stroke-border"
          strokeWidth={b.bar ? 1 : 0.5}
          strokeOpacity={b.bar ? 1 : 0.5}
        />
      ))}
      {/* The output's two bounds, and 0 dashed between them. */}
      {[1, -1].map((v) => (
        <g key={v}>
          <line
            x1={PAD}
            x2={W - PAD}
            y1={yOf(v)}
            y2={yOf(v)}
            className="stroke-muted-foreground"
            strokeOpacity={0.6}
          />
          <text
            x={PAD + 2}
            y={yOf(v) + (v > 0 ? 9 : -3)}
            className="fill-muted-foreground"
            fontSize={8}
          >
            {v}
          </text>
        </g>
      ))}
      <line
        x1={PAD}
        x2={W - PAD}
        y1={yOf(0)}
        y2={yOf(0)}
        className="stroke-border"
        strokeDasharray="3 3"
      />
      <polyline
        points={line}
        fill="none"
        className="stroke-primary"
        strokeWidth={2}
      />
      {parts.faded.length > 0 && (
        <polyline
          points={faded}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeOpacity={0.3}
        />
      )}
      {beats.map((p, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a point is dragged by the pointer; the keyboard edits it with `curve point`
        <circle
          key={draft.points[i]?.time ?? i}
          cx={xOf(spanBeats ? p.beat / spanBeats : 0)}
          cy={yOf(outOf(p.value))}
          r={R}
          className="cursor-grab fill-background stroke-primary"
          strokeWidth={2}
          onPointerDown={(e) => {
            e.stopPropagation();
            svgRef.current?.setPointerCapture(e.pointerId);
            dragging.current = draft.points[i].time;
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            // A drawn curve keeps at least one point: the schema has no empty one.
            if (draft.points.length > 1)
              onPoints(draft.points.filter((_, j) => j !== i));
          }}
        />
      ))}
    </svg>
  );
}
