// ChannelStrip.tsx — one deck's shaping controls, stacked as a mixer's channel strip: three EQ
// knobs and the filter under them. ROTARY, unlike the tempo fader on the other edge — a knob's
// neutral is its middle, and a round one shows that at a glance. See ../../docs/eq.md.

import { EQ_BANDS, EQ_DB, FILTER_RANGE } from "../deck";

/** Degrees either side of straight up — a real knob's ~300° sweep, not a full circle. */
const SWEEP = 150;

/** Where a value sits on the dial, in degrees from straight up. */
export function angleOf(
  value: number,
  [lo, hi]: readonly [number, number],
): number {
  if (!(hi > lo)) return 0;
  const unit = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return (unit * 2 - 1) * SWEEP;
}

/**
 * One knob.
 *
 * Dragged VERTICALLY rather than in a circle. Chasing the pointer round an arc is the obvious
 * reading of a round control and the wrong one: it makes the value jump when the pointer
 * crosses the centre, and it is unusable on a knob this small. Up is more, down is less, over
 * a fixed number of pixels — which is what every DAW does.
 *
 * `setPointerCapture` is what lets the hand leave the knob mid-gesture, and the arrow keys are
 * what make it reachable without a pointer at all. Double-click returns to the middle: the one
 * position worth a shortcut, and the one a drag never lands on exactly.
 */
function Knob({
  label,
  value,
  range,
  step,
  size,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  step: number;
  /** Tailwind size classes — the filter is drawn bigger, being the one a hand throws. */
  size: string;
  /** What the readout says after the number, when it is not at rest. */
  unit: string;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const [lo, hi] = range;
  // Full travel in 160 px: fine enough to place a small move, short enough to reach the ends.
  const PIXELS = 160;
  const round = (v: number) =>
    Math.min(hi, Math.max(lo, Math.round(v / step) * step));
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startValue = value;
    const move = (ev: PointerEvent) =>
      onChange(
        round(startValue + ((startY - ev.clientY) / PIXELS) * (hi - lo)),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const angle = angleOf(value, range);
  const rest = Math.abs(value) < step / 2;
  return (
    <div className="flex flex-col items-center gap-0.5">
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
        aria-disabled={disabled}
        className={`touch-none select-none ${
          disabled ? "opacity-40" : "cursor-ns-resize"
        }`}
        onPointerDown={drag}
        onDoubleClick={() => !disabled && onChange(0)}
        onKeyDown={(e) => {
          if (disabled) return;
          const by = (hi - lo) / 80;
          if (e.key === "ArrowUp" || e.key === "ArrowRight")
            onChange(round(value + by));
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft")
            onChange(round(value - by));
          else if (e.key === "Home") onChange(0);
          else return;
          e.preventDefault();
        }}
        title={
          disabled
            ? "cette platine n'a pas ce module chargé"
            : `${label} — glisser pour régler, double-clic pour revenir au neutre`
        }
      >
        <svg viewBox="0 0 40 40" className={size} aria-hidden="true">
          <title>{label}</title>
          {/* The travel, and the mark at rest — without the mark the dial says how much, never
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
          <line
            x1="20"
            y1="20"
            x2="20"
            y2="8"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={rest ? "stroke-foreground/60" : "stroke-foreground"}
            transform={`rotate(${angle} 20 20)`}
          />
        </svg>
      </div>
      <span className="font-mono text-[9px] text-muted-foreground leading-none">
        {label}
      </span>
      {/* The number, and only when it is NOT at rest: a column of knobs all reading "0" is
          noise, and what a glance wants is which one somebody has touched. */}
      <span className="h-3 font-mono text-[9px] tabular-nums leading-none">
        {rest
          ? ""
          : `${value > 0 ? "+" : ""}${value.toFixed(step < 1 ? 1 : 0)}${unit}`}
      </span>
    </div>
  );
}

/**
 * A deck's strip: grave, médium, aigu, then the filter.
 *
 * VERTICAL, and on the deck's inner edge — the two strips face each other across the middle,
 * so the desk reads as a mirror and a hand knows which deck it is on. The tempo fader keeps
 * the outer edge for the same reason.
 *
 * Each half greys on its own: a project can bind an EQ and no filter, and a strip that went
 * dark as a whole would blame the wrong module.
 */
export function ChannelStrip({
  eq,
  eqLive,
  filter,
  filterLive,
  onEq,
  onFilter,
}: {
  /** dB by band id, `eqLow` / `eqMid` / `eqHigh`. Absent is flat. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  /** −100..+100. Absent is the middle, where the filter is inaudible. */
  filter: number | undefined;
  filterLive: boolean;
  onEq: (band: string, dB: number) => void;
  onFilter: (value: number) => void;
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-3 py-2">
      {EQ_BANDS.map((b) => (
        <Knob
          key={b.id}
          label={b.label}
          value={eq[b.id] ?? 0}
          range={EQ_DB}
          step={0.1}
          size="h-9 w-9"
          unit=""
          onChange={(dB) => onEq(b.id, dB)}
          disabled={!eqLive}
        />
      ))}
      {/* A rule, because the filter is not a fourth band: the three above share a scale and a
          meaning, and this one is a different instrument on the same strip. */}
      <div className="h-px w-8 bg-border" />
      <Knob
        label="FILTRE"
        value={filter ?? 0}
        range={FILTER_RANGE}
        step={1}
        size="h-11 w-11"
        unit="%"
        onChange={onFilter}
        disabled={!filterLive}
      />
    </div>
  );
}
