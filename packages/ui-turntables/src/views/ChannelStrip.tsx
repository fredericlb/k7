// ChannelStrip.tsx — one deck's shaping controls, stacked as a mixer's channel strip: three EQ
// knobs and the filter under them. ROTARY, unlike the tempo fader on the other edge — a knob's
// neutral is its middle, and a round one shows that at a glance. See ../../docs/eq.md.

import { STEMS, type Stem } from "@studio/song-schema/stems";
import { EQ_BANDS, EQ_DB, FILTER_RANGE } from "../deck";
import type { StripLayout } from "../deskLayout";

/** A cut's travel: none of the instrument removed, to all of it. The `stemcut` module's own. */
const CUT_RANGE = [0, 1] as const;

/** What each stem is called under its knob — short, because the label sits under a 36 px dial. */
const STEM_LABELS: Record<Stem, string> = {
  drums: "BATT",
  bass: "BASSE",
  other: "RESTE",
  vocals: "VOIX",
};

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

/**
 * The arc from NEUTRAL to where the knob is — the value, drawn round the dial.
 *
 * It says the one thing the needle does not: how far from the middle, and which way, at a
 * glance and without reading. Straight up is 0 dB / no filter, so the arc grows clockwise for a
 * boost and anticlockwise for a cut, and its length IS the amount. That matters most on a short
 * strip, where the numeric readouts are dropped for height (`deskLayout`) and this is the only
 * thing left saying how much.
 *
 * Empty at rest, deliberately: an arc of zero length is what "untouched" looks like, and a
 * column of knobs all showing a stub would be the noise the readouts were dropped to avoid.
 *
 * `largeArcFlag` is 0 always and safely: the sweep is ±150°, so an arc from centre-top can
 * never exceed 180° and would take the wrong way round only if it could.
 */
export function arcPath(deg: number, radius: number): string {
  if (!(radius > 0) || Math.abs(deg) < 0.5) return "";
  const from = onDial(0, radius);
  const to = onDial(deg, radius);
  // Sweep 1 goes clockwise (a boost, to the right), 0 anticlockwise (a cut).
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${deg > 0 ? 1 : 0} ${to.x} ${to.y}`;
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
  readout,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  step: number;
  /** The dial's diameter in px — the filter is drawn bigger, being the one a hand throws, and
   *  both shrink together on a short deck. A NUMBER and not a Tailwind class, because the size
   *  is computed from the room there is (`deskLayout`) and Tailwind cannot spell an arbitrary
   *  one without a full class name it can see at build time. */
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
        <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
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
          {/* The VALUE, as an arc from twelve o'clock — see `arcPath`. Two paths: the whole
              travel, faint, so the arc is read against what it could have been rather than
              against nothing, and the arc itself over it.

              Outside the dial's face (r=18 against the circle's 15) so it never fights the
              needle for the same pixels, and `butt` caps so a small value is a small mark
              rather than a round blob two pixels long. */}
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
      <span className="font-mono text-[9px] text-muted-foreground leading-none">
        {label}
      </span>
      {/* The number, and only when it is NOT at rest: a column of knobs all reading "0" is
          noise, and what a glance wants is which one somebody has touched.

          Dropped whole on a short strip — the value is a convenience and the knob is the
          control, so this is the line that pays for the filter still being on screen. The
          angle still says roughly where the knob is, which is what the dial is for. */}
      {readout ? (
        <span className="h-3 font-mono text-[9px] tabular-nums leading-none">
          {rest
            ? ""
            : `${value > 0 ? "+" : ""}${value.toFixed(step < 1 ? 1 : 0)}${unit}`}
        </span>
      ) : null}
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
  layout,
  onEq,
  onFilter,
}: {
  /** dB by band id, `eqLow` / `eqMid` / `eqHigh`. Absent is flat. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  /** −100..+100. Absent is the middle, where the filter is inaudible. */
  filter: number | undefined;
  filterLive: boolean;
  /** How big to draw, for the height this deck has — see `stripLayout`. */
  layout: StripLayout;
  onEq: (band: string, dB: number) => void;
  onFilter: (value: number) => void;
}) {
  return (
    // `justify-center` and NO overflow, which is only safe because `layout` guarantees the
    // content fits: a strip taller than its box overflows at both ends under this rule, and the
    // two things at the ends are the top EQ knob and the filter. That is exactly how the filter
    // went missing in a pane. See ../deskLayout.ts.
    <div
      className="flex w-16 shrink-0 flex-col items-center justify-center py-2"
      style={{ gap: `${layout.gap}px` }}
    >
      {EQ_BANDS.map((b) => (
        <Knob
          key={b.id}
          label={b.label}
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
      {/* A rule, because the filter is not a fourth band: the three above share a scale and a
          meaning, and this one is a different instrument on the same strip. */}
      <div className="h-px w-8 shrink-0 bg-border" />
      <Knob
        label="FILTRE"
        value={filter ?? 0}
        range={FILTER_RANGE}
        step={1}
        size={layout.filter}
        readout={layout.readout}
        unit="%"
        onChange={onFilter}
        disabled={!filterLive}
      />
    </div>
  );
}

/**
 * A deck's STEMS: one knob per separated instrument, to the LEFT of the deck.
 *
 * The same column as the strip beside it — the same knob, the same ladder of sizes, the same
 * `justify-center` — because it is the same gesture on the same kind of thing. What differs is
 * what the travel means: an EQ knob's middle is neutral and it goes both ways, where a cut
 * starts at nothing removed and only goes up. So the arc grows from the LEFT of the dial rather
 * than from the top, which is what `range` already does for any control whose rest is its floor.
 *
 * Not drawn at all when the set wires no stem cut (`live` false). A desk that predates them is
 * a complete desk, and four dead knobs would be worse than none — the same argument the filter
 * makes for greying on its own rather than taking the strip with it.
 *
 * `ready` is the other half: the knobs are wired, but this record has never been separated, so
 * there is nothing to take out of it. Greyed with the reason on the title, because that state is
 * fixed by preparing the set (`playlist stems`) and not by touching anything here.
 *
 * `prep` is that same state while it is being FIXED — the catch-up the desk starts when a set
 * declares a separating chain and the record it was handed had none. See ../../docs/stems.md.
 */
export function StemStrip({
  stems,
  live,
  ready,
  prep,
  layout,
  onStem,
}: {
  /** 0..1 by stem, what is currently being REMOVED. Absent is none of it. */
  stems: Partial<Record<Stem, number>>;
  live: boolean;
  ready: boolean;
  /** The separation running for this deck's record, or the reason there will not be one. */
  prep: StemPrep | undefined;
  layout: StripLayout;
  onStem: (stem: Stem, cut: number) => void;
}) {
  if (!live) return null;
  return (
    // `relative`, for the badge below. The column's HEIGHT is the one thing that may not move:
    // it borrows the strip's ladder of sizes and is only allowed to because it is shorter at
    // every step (`stemStripHeight`), so progress is drawn OVER the knobs rather than above them.
    // A line of text here would be seven pixels the smallest step has not got.
    <div
      className="relative flex w-16 shrink-0 flex-col items-center justify-center py-2"
      style={{ gap: `${layout.gap}px` }}
      title={titleFor(ready, prep)}
    >
      {STEMS.map((s) => (
        <Knob
          key={s}
          label={STEM_LABELS[s]}
          value={stems[s] ?? 0}
          range={CUT_RANGE}
          // Percent under the hand, 0..1 on the wire: `Cut` is a proportion, and a knob that
          // read "0.4" would be the one control on this desk speaking in units nobody says.
          step={0.01}
          size={layout.knob}
          readout={layout.readout}
          unit=""
          onChange={(v) => onStem(s, v)}
          disabled={!ready}
        />
      ))}
      {/* Over the dead knobs, which is where the eye already is when it wonders why they are
          dead. A percent and nothing else: the phase is a word too long for a 64 px column, so
          it goes in the title with everything else worth reading slowly. */}
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

/**
 * A separation running for what is on a deck, or the reason it will not finish.
 *
 * Held by the view that starts it rather than by the deck document: a job belongs to this
 * machine and this tab, where the loaded song outlives both.
 */
export type StemPrep =
  | { k: "running"; phase: string; percent: number | null }
  | { k: "failed"; why: string };

/** The one sentence the column says on hover, and it is different in all four states. */
function titleFor(ready: boolean, prep: StemPrep | undefined): string {
  if (prep?.k === "failed") return `La séparation a échoué : ${prep.why}`;
  if (prep)
    return `Séparation en cours (${prep.phase}) — les potards s'allumeront à la fin`;
  if (ready) return "Retirer un instrument du morceau";
  // No chain declared, or the record was prepared elsewhere: the two commands that fix it, since
  // nothing on this column can.
  return (
    "Ce morceau n'a pas été séparé — préparez la playlist (playlist stems), " +
    "ou nommez une chaîne dans le `stems:` de la surface pour que le pupitre le fasse lui-même"
  );
}
