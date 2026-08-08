// EqStrip.tsx — one deck's three EQ knobs, low to high. A ROTARY control, unlike the tempo
// beside it: an EQ knob's neutral is its middle, and a round one shows that at a glance.
// See ../../docs/eq.md.

import { EQ_BANDS, EQ_DB } from "../deck";

/** Degrees either side of straight up — a real knob's ~300° sweep, not a full circle. */
const SWEEP = 150;

/** Where a value sits on the dial, in degrees from straight up. */
export function angleOf(dB: number, [lo, hi]: readonly [number, number]): number {
  if (!(hi > lo)) return 0;
  const unit = Math.min(1, Math.max(0, (dB - lo) / (hi - lo)));
  return (unit * 2 - 1) * SWEEP;
}

/**
 * One knob.
 *
 * Dragged VERTICALLY rather than in a circle. Chasing the pointer round an arc is the
 * obvious reading of a round control and the wrong one: it makes the gain jump when the
 * pointer crosses the centre, and it is unusable on a knob this small. Up is more, down is
 * less, and the travel is a fixed number of pixels — which is what every DAW does.
 *
 * `setPointerCapture` is what lets the hand leave the 40 pixels of the knob mid-gesture, and
 * the arrow keys are what make it reachable without a pointer at all. Double-click returns to
 * flat: the one position worth a shortcut, and the one a drag never lands on exactly.
 */
function Knob({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (dB: number) => void;
  disabled: boolean;
}) {
  const [lo, hi] = EQ_DB;
  // Full travel in 160 px: fine enough to place a 3 dB cut, short enough to reach the ends.
  const PIXELS = 160;
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startValue = value;
    const move = (ev: PointerEvent) => {
      const next = startValue + ((startY - ev.clientY) / PIXELS) * (hi - lo);
      onChange(Math.min(hi, Math.max(lo, Math.round(next * 10) / 10)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const step = (by: number) =>
    onChange(Math.min(hi, Math.max(lo, Math.round((value + by) * 10) / 10)));

  const angle = angleOf(value, EQ_DB);
  const flat = Math.abs(value) < 0.05;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
      {/* biome-ignore lint/a11y/useSemanticElements: a slider's ROLE is what this needs; an
          <input type=range> cannot be drawn as a dial, and the role plus the value pair is
          exactly what a screen reader wants either way. */}
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={value}
        aria-valuetext={`${value.toFixed(1)} décibels`}
        aria-disabled={disabled}
        className={`touch-none select-none ${
          disabled ? "opacity-40" : "cursor-ns-resize"
        }`}
        onPointerDown={drag}
        onDoubleClick={() => !disabled && onChange(0)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") step(0.5);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") step(-0.5);
          else if (e.key === "Home") onChange(0);
          else return;
          e.preventDefault();
        }}
        title={
          disabled
            ? "aucun EQ chargé sur cette platine"
            : `${label} — glisser pour régler, double-clic pour revenir à plat`
        }
      >
        <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
          <title>{label}</title>
          {/* The travel, and the mark at flat — without the mark the dial says how much, never
              how far from neutral, which is the thing you actually read mid-set. */}
          <circle
            cx="20"
            cy="20"
            r="15"
            className="fill-muted stroke-border"
            strokeWidth="1.5"
          />
          <line
            x1="20"
            y1="3"
            x2="20"
            y2="6"
            className="stroke-foreground/40"
            strokeWidth="1.5"
          />
          {/* The pointer. Rotated about the centre, so the transform IS the value. */}
          <line
            x1="20"
            y1="20"
            x2="20"
            y2="8"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={flat ? "stroke-foreground/60" : "stroke-foreground"}
            transform={`rotate(${angle} 20 20)`}
          />
        </svg>
      </div>
      <span className="font-mono text-[9px] text-muted-foreground tabular-nums">
        {label}
      </span>
      {/* The number, and only when it is NOT flat: six knobs all reading "0.0" is noise, and
          what a glance wants is which band somebody has touched. */}
      <span className="h-3 font-mono text-[9px] tabular-nums">
        {flat ? "" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
      </span>
    </div>
  );
}

/**
 * A deck's EQ: grave, médium, aigu.
 *
 * `disabled` when the project binds no EQ this engine has loaded. Greyed rather than hidden,
 * because a strip that vanishes reads as a layout bug where a greyed one reads as a project
 * that has not wired it — and the tooltip says which.
 */
export function EqStrip({
  values,
  onChange,
  disabled,
}: {
  /** dB by band id, `eqLow` / `eqMid` / `eqHigh`. Absent is flat. */
  values: Partial<Record<string, number>>;
  onChange: (band: string, dB: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full items-start justify-center gap-1">
      {EQ_BANDS.map((b) => (
        <Knob
          key={b.id}
          label={b.label}
          value={values[b.id] ?? 0}
          onChange={(dB) => onChange(b.id, dB)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
