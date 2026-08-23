// Ruler.tsx — the arrangement ruler, ONE component: the timeline draws it over its lanes, and
// the clip editors (piano roll, audio clip panel) draw the same one over their material, offset
// to where the clip sits in the song. One tick ladder, one label stride, one look — a position
// reads the same wherever it is met. See docs/timeline.md for the ladder's rationale.

import { cn } from "@frediverse/ui/lib/utils";
import {
  chooseTick,
  formatClock,
  SECOND_TICKS,
  ticksUpTo,
} from "@studio/ui-timeline/ticks";
import {
  labelled,
  labelMinPx,
  labelStride,
  nearestTick,
  subdivideBeats,
} from "@studio/ui-waveform";
import { memo, type RefObject, useEffect, useState } from "react";

/** What the ruler is READING IN — not what the song is placed in, which is always beats; a per-SESSION toggle (docs/picture.md). */
export type RulerMode = "bars" | "seconds";

// A tick's weight and its number — at module level because two things ask, the ruler and the lanes' grid, and they must read one answer.
const tickAt = (b: number, barBeats: number) => {
  const bar = Math.abs(b / barBeats - Math.round(b / barBeats)) < 1e-6;
  const onBeat = Math.abs(b - Math.round(b)) < 1e-6;
  return {
    bar,
    onBeat,
    label: bar
      ? String(Math.round(b / barBeats) + 1)
      : onBeat
        ? `${Math.floor(b / barBeats) + 1}.${Math.round(b % barBeats) + 1}`
        : "",
  };
};

// Every tick drawn between the view's edges, from the ruler's ORIGIN rather than the first visible one, so the two cannot drift as you pan.
const tickBeats = (
  beatLo: number,
  lastBeat: number,
  unit: number,
): number[] => {
  const out: number[] = [];
  for (let b = Math.ceil(beatLo / unit - 1e-9) * unit; b <= lastBeat; b += unit)
    out.push(b);
  return out;
};

export interface RulerTick {
  beat: number; // where it sits — the surface's one coordinate, whatever the ruler counts in
  index: number; // its number from the ORIGIN, for the label stride
  key: string;
  label: string;
  // Coarse / medium / fine — a bar, a beat, a subdivision; or a minute, a second, a fraction.
  level: 0 | 1 | 2;
}

/** The ticks a ruler draws, in BEATS whichever unit it reads in — one function for both ladders, called separately so no array prop defeats the memo. */
export const rulerTicks = (
  mode: RulerMode,
  beatLo: number,
  lastBeat: number,
  unit: number,
  barBeats: number,
  bps: number, // beats per second — the whole of the conversion, since there is no tempo map
  secStep: number,
  /** The slice actually ON SCREEN, when the caller knows it — what makes the zoom unbounded, `index` still being computed from the ORIGIN. */
  view?: { lo: number; hi: number },
): RulerTick[] => {
  const lo = Math.max(beatLo, view?.lo ?? beatLo);
  const hi = Math.min(lastBeat, view?.hi ?? lastBeat);
  if (mode === "bars")
    return tickBeats(lo, hi, unit).map((b) => {
      const { bar, onBeat, label } = tickAt(b, barBeats);
      return {
        beat: b,
        index: Math.round(b / unit),
        key: `b:${b}`,
        label,
        level: bar ? 0 : onBeat ? 1 : 2,
      };
    });
  const out: RulerTick[] = [];
  // From the ORIGIN and not from the first visible second, exactly as `tickBeats` is, or panning would re-place every line.
  for (const sec of ticksUpTo(hi / bps, secStep)) {
    const beat = sec * bps;
    if (beat < lo - 1e-9) continue;
    const whole = Math.abs(sec - Math.round(sec)) < 1e-6;
    out.push({
      beat,
      index: Math.round(sec / secStep),
      key: `s:${sec}`,
      label: formatClock(sec, secStep),
      // A minute carries the bar's weight and a whole second the beat's, so the eye reads the same three-level rhythm in either unit.
      level: Math.abs(sec % 60) < 1e-6 ? 0 : whole ? 1 : 2,
    });
  }
  return out;
};

/** How far past each edge the ticks are still built, in px — a scroll must reveal lines, not a bare strip. */
const VIEW_MARGIN_PX = 400;

/** The beat range on screen, watched HERE rather than by the surface that owns the scroller, so a scroll re-renders the lines and nothing else. */
function useVisibleBeats(
  scroller: RefObject<HTMLElement | null> | undefined,
  beatLo: number,
  ppb: number,
): { lo: number; hi: number } | undefined {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const el = scroller?.current;
    if (!el) return;
    const read = () => setBox({ left: el.scrollLeft, width: el.clientWidth });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [scroller]);
  if (!box || !(ppb > 0)) return undefined;
  return {
    lo: beatLo + (box.left - VIEW_MARGIN_PX) / ppb,
    hi: beatLo + (box.left + box.width + VIEW_MARGIN_PX) / ppb,
  };
}

/** What a tick layer needs to rebuild its own list — all primitives, so a memo holds. */
export interface TickProps {
  mode: RulerMode;
  beatLo: number;
  lastBeat: number;
  unit: number;
  barBeats: number;
  bps: number;
  secStep: number;
}

/** The scale a ruler draws at — ONE function, so the timeline and the clip editors cannot pick different ladders for the same zoom. */
export function rulerScale(
  mode: RulerMode,
  ppb: number,
  barBeats: number,
  bps: number,
  lastBeat: number,
): { unit: number; secStep: number; barStride: number } {
  const unit = subdivideBeats(barBeats, ppb);
  const secStep = chooseTick(
    SECOND_TICKS,
    ppb / bps,
    labelMinPx(formatClock(Math.max(lastBeat, 0) / bps, 1)),
  );
  const lastBarNo = Math.floor(Math.max(lastBeat, 0) / barBeats) + 1;
  const widestLabel =
    unit < barBeats
      ? `${lastBarNo}.${Math.round(barBeats)}`
      : String(lastBarNo);
  const barStride =
    mode === "bars" ? labelStride(unit * ppb, labelMinPx(widestLabel)) : 1;
  return { unit, secStep, barStride };
}

/** The tick layer, memoised: a pure function of the VIEW WINDOW, every prop a number, so a host re-render leaves it untouched (docs/timeline.md). */
export const RulerTicks = memo(function RulerTicks({
  mode,
  beatLo,
  lastBeat,
  unit,
  barBeats,
  bps,
  secStep,
  ppb,
  barStride,
  scroller,
}: TickProps & {
  ppb: number;
  barStride: number;
  /** The pane these lines scroll inside, so only the visible ones are built. See useVisibleBeats. */
  scroller?: RefObject<HTMLElement | null>;
}) {
  const view = useVisibleBeats(scroller, beatLo, ppb);
  return (
    <>
      {rulerTicks(
        mode,
        beatLo,
        lastBeat,
        unit,
        barBeats,
        bps,
        secStep,
        view,
      ).map((t) => (
        // Three weights, strided on the tick's index from the ORIGIN, or the surviving labels would change as scrolling moved the first one.
        <div
          key={t.key}
          className={cn(
            "pointer-events-none absolute top-0 h-full border-l pl-1",
            t.level === 0
              ? "border-border/50 text-muted-foreground"
              : t.level === 1
                ? "border-border/30 text-muted-foreground/60"
                : "border-border/15",
          )}
          style={{ left: (t.beat - beatLo) * ppb }}
        >
          {labelled(t.index, barStride) ? t.label : ""}
        </div>
      ))}
    </>
  );
});

/** The GRID that matches those ticks, one step fainter — here beside `RulerTicks`, since a line under the ruler has to be a line the ruler drew. */
export const Grid = memo(function Grid({
  mode,
  beatLo,
  lastBeat,
  unit,
  barBeats,
  bps,
  secStep,
  ppb,
  laneW,
  left0,
  top,
  height,
  scroller,
}: TickProps & {
  ppb: number;
  laneW: number;
  left0: number;
  top: number;
  height: number;
  /** The pane these lines scroll inside, so only the visible ones are built. See useVisibleBeats. */
  scroller?: RefObject<HTMLElement | null>;
}) {
  const view = useVisibleBeats(scroller, beatLo, ppb);
  return (
    <>
      {rulerTicks(
        mode,
        beatLo,
        lastBeat,
        unit,
        barBeats,
        bps,
        secStep,
        view,
      ).map((t) => {
        const left = (t.beat - beatLo) * ppb;
        // A tick at the lane's right edge is a 1px border past the end of the box, and one pixel of horizontal scroll.
        if (left >= laneW) return null;
        return (
          <div
            key={`grid:${t.key}`}
            className={cn(
              "pointer-events-none absolute border-l border-dashed",
              // The ruler's three weights, one step fainter: down here they cross the material rather than sitting in a header of their own.
              t.level === 0
                ? "border-border/40"
                : t.level === 1
                  ? "border-border/25"
                  : "border-border/10",
            )}
            style={{ left: left0 + left, top, height }}
          />
        );
      })}
    </>
  );
});

/** The ruler a clip editor stacks over its material: the SONG's positions, anchored at the SONG's origin, and a click seeks the nearest drawn tick. */
export function ArrangementRuler({
  startBeat,
  beats,
  ppb,
  barBeats,
  tempo,
  height,
  onSeek,
  className,
}: {
  /** Arrangement beat at the strip's left edge. */
  startBeat: number;
  /** Beats the strip spans. */
  beats: number;
  ppb: number;
  barBeats: number;
  tempo: number;
  height: number;
  /** Seek the transport, in SONG seconds — the same callback the timeline's ruler takes. */
  onSeek?: (seconds: number) => void;
  className?: string;
}) {
  const bps = Math.max(1e-6, tempo / 60);
  const lastBeat = startBeat + beats;
  const { unit, secStep, barStride } = rulerScale(
    "bars",
    ppb,
    barBeats,
    bps,
    lastBeat,
  );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard's seek is the shell's `t`, not this strip
    // biome-ignore lint/a11y/noStaticElementInteractions: same — the strip is a scrubber, not a control in the tab order
    <div
      className={cn(
        "relative select-none overflow-hidden",
        onSeek && "cursor-pointer",
        className,
      )}
      style={{ height }}
      title={
        onSeek
          ? "position dans le morceau — cliquer y place la tête de lecture"
          : "position dans le morceau"
      }
      onClick={
        onSeek
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const raw = Math.max(
                0,
                startBeat + (e.clientX - rect.left) / ppb,
              );
              // Snapped to the nearest tick the ruler DREW, the timeline's own rule.
              const ticks = rulerTicks(
                "bars",
                startBeat,
                lastBeat,
                unit,
                barBeats,
                bps,
                secStep,
              ).map((t) => t.beat);
              onSeek(((nearestTick(ticks, raw) ?? raw) * 60) / tempo);
            }
          : undefined
      }
    >
      <RulerTicks
        mode="bars"
        beatLo={startBeat}
        lastBeat={lastBeat}
        unit={unit}
        barBeats={barBeats}
        bps={bps}
        secStep={secStep}
        ppb={ppb}
        barStride={barStride}
      />
    </div>
  );
}
