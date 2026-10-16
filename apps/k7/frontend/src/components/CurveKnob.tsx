// CurveKnob.tsx — one knob of the curve editor's envelope: a dial dragged up and down, its name under
// it and its value in ms. Shift drags finely. A plain control, not the graph's widget: what it sets is
// the editor's draft, which is written once, on Save. See docs/curveEditor.md.

import { useRef } from "react";

const SIZE = 44;
/** Pixels of drag that sweep the whole range; Shift is ten times finer. */
const TRAVEL = 160;

export function CurveKnob({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const drag = useRef<{ y: number; from: number } | null>(null);
  const t = (value - min) / (max - min || 1);
  const START = Math.PI * 0.75;
  const SWEEP = Math.PI * 1.5;
  const c = SIZE / 2;
  const R = c - 4;
  const pt = (a: number) => [c + Math.cos(a) * R, c + Math.sin(a) * R];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const a = START + SWEEP * Math.max(0, Math.min(1, t));
  const [ix, iy] = pt(a);
  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      {/* The slider is the wrapper: it takes the pointer, the focus and the arrow keys. */}
      <div
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, from: value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const span =
            (max - min) * ((d.y - e.clientY) / TRAVEL) * (e.shiftKey ? 0.1 : 1);
          onChange(Math.round(Math.min(max, Math.max(min, d.from + span))));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          const step = ((max - min) / 100) * (e.shiftKey ? 0.1 : 1);
          const dir =
            e.key === "ArrowUp" || e.key === "ArrowRight"
              ? 1
              : e.key === "ArrowDown" || e.key === "ArrowLeft"
                ? -1
                : 0;
          if (!dir) return;
          e.preventDefault();
          onChange(
            Math.round(
              Math.min(max, Math.max(min, value + dir * Math.max(1, step))),
            ),
          );
        }}
      >
        <svg width={SIZE} height={SIZE} aria-hidden="true">
          <path
            d={arc(START, START + SWEEP)}
            fill="none"
            className="stroke-border"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {t > 0 && (
            <path
              d={arc(START, a)}
              fill="none"
              className="stroke-primary"
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <line
            x1={c}
            y1={c}
            x2={ix}
            y2={iy}
            className="stroke-foreground"
            strokeWidth={2}
          />
        </svg>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
}
