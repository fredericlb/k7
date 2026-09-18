// ChannelStrip.tsx — one deck's shaping controls, stacked as a mixer's channel strip: three EQ
// knobs and the filter under them. ROTARY, unlike the tempo fader on the other edge — a knob's
// neutral is its middle, and a round one shows that at a glance. See ../../docs/eq.md.

import { STEM_NEUTRAL, STEM_RANGE, type Stem } from "@studio/song-schema/stems";
import {
  Activity,
  AudioLines,
  Drum,
  Filter,
  Guitar,
  type LucideIcon,
  Mic,
  Music,
  Repeat,
  SlidersHorizontal,
  Waves,
} from "lucide-react";
import {
  ECHO_RANGE,
  EQ_BANDS,
  EQ_DB,
  FILTER_RANGE,
  TRIM_DB,
} from "../deckVocabulary";
import type { StripLayout } from "../deskLayout";

/** What each stem is called under its knob — short, because the label sits under a 36 px dial. */
const STEM_LABELS: Record<Stem, string> = {
  drums: "BATT",
  bass: "BASSE",
  other: "RESTE",
  vocals: "VOIX",
};

/** …and the glyph beside it: the instrument, so a hand finds the knob without reading — ../../docs/stems.md. */
export const STEM_ICONS: Record<Stem, LucideIcon> = {
  drums: Drum,
  bass: Guitar,
  // The catch-all keeps the generic one on purpose: naming an instrument would name the wrong one.
  other: Music,
  vocals: Mic,
};

/** The EQ's three, by band id: a rolling wave low, a busier line mid, a spiky one high — ../../docs/eq.md. */
export const EQ_ICONS: Record<string, LucideIcon> = {
  eqLow: Waves,
  eqMid: AudioLines,
  eqHigh: Activity,
};

/** The 2x2 reading order: the rhythm section on the top row, the voice and the rest under it. */
export const STEM_GRID: readonly Stem[] = ["drums", "bass", "vocals", "other"];

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

/** The knob's centre, in the 40×40 viewBox it is drawn in. */
const KNOB_CENTRE = 20;

/** A point on the knob's dial, `deg` degrees clockwise from straight up. */
function onDial(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: KNOB_CENTRE + radius * Math.cos(rad),
    y: KNOB_CENTRE + radius * Math.sin(rad),
  };
}

/** The arc from NEUTRAL to where the knob is, empty at rest — see ../../docs/eq.md. */
export function arcPath(deg: number, radius: number): string {
  if (!(radius > 0) || Math.abs(deg) < 0.5) return "";
  const from = onDial(0, radius);
  const to = onDial(deg, radius);
  // Sweep 1 goes clockwise (a boost, to the right), 0 anticlockwise (a cut).
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${deg > 0 ? 1 : 0} ${to.x} ${to.y}`;
}

/** One knob, dragged VERTICALLY rather than round its arc — see ../../docs/eq.md. */
function Knob({
  label,
  icon: Icon,
  value,
  range,
  neutral = 0,
  step,
  size,
  readout,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  /** The glyph on the label's line, when the control has one — the knob draws whatever it is handed. */
  icon?: LucideIcon;
  value: number;
  range: readonly [number, number];
  /** Where the knob comes back to on a double-click, and what it reads as at rest. */
  neutral?: number;
  step: number;
  /** The dial's diameter in px — a NUMBER, since `deskLayout` computes it and Tailwind cannot spell it. */
  size: number;
  /** Show the value under the label? The first thing to go when the strip is short. */
  readout: boolean;
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
  const rest = Math.abs(value - neutral) < step / 2;
  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* A dial, so role + value pair rather than <input type=range>, which cannot be drawn as one. */}
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
        onDoubleClick={() => !disabled && onChange(neutral)}
        onKeyDown={(e) => {
          if (disabled) return;
          const by = (hi - lo) / 80;
          if (e.key === "ArrowUp" || e.key === "ArrowRight")
            onChange(round(value + by));
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft")
            onChange(round(value - by));
          else if (e.key === "Home") onChange(neutral);
          else return;
          e.preventDefault();
        }}
        title={
          disabled
            ? "this deck has not got that module loaded"
            : `${label} — drag to set, double-click to go back to neutral`
        }
      >
        <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
          <title>{label}</title>
          {/* The travel and the mark at rest: without the mark the dial never says how far from neutral. */}
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
          {/* The VALUE, as an arc from twelve o'clock, over a faint full travel — ../../docs/eq.md. */}
          <path
            d={`${arcPath(-SWEEP, 18)} ${arcPath(SWEEP, 18)}`}
            fill="none"
            strokeWidth="2"
            className="stroke-border"
          />
          <path
            d={arcPath(angle, 18)}
            fill="none"
            strokeWidth="2"
            strokeLinecap="butt"
            className="stroke-foreground"
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
      <span className="flex items-center gap-[2px] font-mono text-[9px] text-muted-foreground leading-none">
        {/* Sized to the LABEL's line so the block's height arithmetic is untouched — ../deskLayout.ts. */}
        {Icon ? (
          <Icon className="h-[9px] w-[9px] shrink-0" aria-hidden />
        ) : null}
        {label}
      </span>
      {/* The number, only off rest, and dropped whole on a short strip — ../../docs/eq.md. */}
      {readout ? (
        <span className="h-3 font-mono text-[9px] tabular-nums leading-none">
          {rest
            ? ""
            : `${value > neutral ? "+" : ""}${value.toFixed(step < 1 ? 1 : 0)}${unit}`}
        </span>
      ) : null}
    </div>
  );
}

/** A deck's strip on its INNER edge — each half greys on its own, or it would blame the wrong module.
 *
 * Top to bottom IS the signal path: the trim in front, then the three bands, then the filter a hand
 * throws, then the one effect past it. See ../../docs/mix.md. */
export function ChannelStrip({
  trim,
  trimLive,
  eq,
  eqLive,
  filter,
  filterLive,
  echo,
  echoLive,
  layout,
  onTrim,
  onEq,
  onFilter,
  onEcho,
}: {
  /** The input gain in dB, ±12. Absent is unity, which is mid-travel. */
  trim: number | undefined;
  trimLive: boolean;
  /** dB by band id, `eqLow` / `eqMid` / `eqHigh`. Absent is flat. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  /** −100..+100. Absent is the middle, where the filter is inaudible. */
  filter: number | undefined;
  filterLive: boolean;
  /** 0..1, dry to wet. Absent is dry — and an unwired echo draws no knob at all. */
  echo: number | undefined;
  echoLive: boolean;
  /** How big to draw, for the height this deck has — see `stripLayout`. */
  layout: StripLayout;
  onTrim: (dB: number) => void;
  onEq: (band: string, dB: number) => void;
  onFilter: (value: number) => void;
  onEcho: (wet: number) => void;
}) {
  return (
    // `justify-center` and NO overflow, safe only because `layout` guarantees a fit (../deskLayout.ts).
    <div
      className="flex w-16 shrink-0 flex-col items-center justify-center py-2"
      style={{ gap: `${layout.gap}px` }}
    >
      {/* FIRST, because it is first in the signal: everything below shapes what this one set. */}
      <Knob
        label="TRIM"
        icon={SlidersHorizontal}
        value={trim ?? 0}
        range={TRIM_DB}
        step={0.1}
        size={layout.knob}
        readout={layout.readout}
        unit=""
        onChange={onTrim}
        disabled={!trimLive}
      />
      <div className="h-px w-8 shrink-0 bg-border" />
      {EQ_BANDS.map((b) => (
        <Knob
          key={b.id}
          label={b.label}
          icon={EQ_ICONS[b.id]}
          value={eq[b.id] ?? 0}
          range={EQ_DB}
          step={0.1}
          size={layout.knob}
          readout={layout.readout}
          unit=""
          onChange={(dB) => onEq(b.id, dB)}
          disabled={!eqLive}
        />
      ))}
      {/* A rule, because the filter is not a fourth band but a different instrument on the same strip. */}
      <div className="h-px w-8 shrink-0 bg-border" />
      <Knob
        label="FILTRE"
        icon={Filter}
        value={filter ?? 0}
        range={FILTER_RANGE}
        step={1}
        size={layout.filter}
        readout={layout.readout}
        unit="%"
        onChange={onFilter}
        disabled={!filterLive}
      />
      {/* ABSENT and not greyed, unlike every knob above: a set that wires no effect is a complete
          set, so there is nothing here to go and fix. Same rule as the stems — ../../docs/fx.md. */}
      {echoLive ? (
        <>
          <div className="h-px w-8 shrink-0 bg-border" />
          <Knob
            label="ECHO"
            icon={Repeat}
            value={echo ?? 0}
            range={ECHO_RANGE}
            step={0.01}
            size={layout.knob}
            readout={false}
            unit=""
            onChange={onEcho}
            disabled={false}
          />
        </>
      ) : null}
    </div>
  );
}

/** A deck's STEMS, to the LEFT of both decks — four states, four readings: ../../docs/stems.md. */
export function StemStrip({
  stems,
  live,
  ready,
  prep,
  layout,
  onStem,
}: {
  /** 0..2 by stem: 0 drops the part, 1 is as it was cut, 2 doubles it. Absent reads as unity. */
  stems: Partial<Record<Stem, number>>;
  live: boolean;
  ready: boolean;
  /** The separation running for this deck's record, or the reason there will not be one. */
  prep: StemPrep | undefined;
  layout: StripLayout;
  onStem: (stem: Stem, level: number) => void;
}) {
  if (!live) return null;
  return (
    // `relative`, for the badge: the column's HEIGHT may not move, so progress is drawn OVER the knobs.
    <div
      className="relative grid w-32 shrink-0 grid-cols-2 content-center justify-items-center py-2"
      style={{ gap: `${layout.gap}px` }}
      title={titleFor(ready, prep)}
    >
      {STEM_GRID.map((s) => (
        <Knob
          key={s}
          label={STEM_LABELS[s]}
          icon={STEM_ICONS[s]}
          value={stems[s] ?? STEM_NEUTRAL}
          range={STEM_RANGE}
          // The record as it was cut sits mid-travel, so that is what a double-click comes back to.
          neutral={STEM_NEUTRAL}
          // Percent under the hand, −1..1 on the wire — nobody reads a level as "0.4".
          step={0.01}
          size={layout.knob}
          readout={layout.readout}
          unit=""
          onChange={(v) => onStem(s, v)}
          disabled={!ready}
        />
      ))}
      {/* Over the dead knobs, a percent only: the phase is a word too long for a 64 px column. */}
      {prep ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-none ${
              prep.k === "failed"
                ? "bg-destructive/15 text-destructive"
                : "bg-background/85 text-muted-foreground"
            }`}
          >
            {prep.k === "failed"
              ? "!"
              : prep.percent == null
                ? "…"
                : `${prep.percent}%`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** A separation running for what is on a deck, or why it will not finish — a job belongs to THIS tab. */
export type StemPrep =
  | { k: "running"; phase: string; percent: number | null }
  | { k: "failed"; why: string };

/** The one sentence the column says on hover, and it is different in all four states. */
function titleFor(ready: boolean, prep: StemPrep | undefined): string {
  if (prep?.k === "failed") return `The separation failed: ${prep.why}`;
  if (prep)
    return `Separating (${prep.phase}) — the knobs light up when it is done`;
  if (ready) return "Take an instrument out of the song";
  // Nothing on this column fixes it, so the sentence names the two commands that do.
  return (
    "This song has not been separated — prepare the playlist (playlist stems), " +
    "or name a chain in the surface's `stems:` so the desk does it itself"
  );
}
