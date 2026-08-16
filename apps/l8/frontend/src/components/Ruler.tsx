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
import { memo } from "react";

/**
 * What the ruler is READING IN. Not what the song is placed in — that is always beats.
 *
 * A song's positions are musical and a `video_tracks/` placement's are wall-clock, and one
 * surface carries both. The two are exactly convertible here (one `tempo:`, no tempo map), so
 * nothing is lost either way round — but a cut is read in minutes and seconds, and a ruler that
 * could only count bars makes picture unreadable however accurately it is drawn.
 *
 * A per-SESSION toggle, deliberately not a project setting: which unit you want depends on what
 * you are doing this minute, not on what the song is. See docs/picture.md.
 */
export type RulerMode = "bars" | "seconds";

// A tick's weight and its number: a bar keeps its own, a beat inside one is numbered within
// the bar (5.2, 5.3…), and anything finer is a line with no number at all. At module level
// because two things ask — the ruler and the lanes' grid — and they must read one answer.
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

// Every tick drawn between the view's edges, from the ruler's ORIGIN rather than from the
// first visible one — the ruler and the grid both walk this, and computing it twice from one
// formula is what stops them drifting apart as you pan.
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

/**
 * The ticks a ruler draws, in BEATS whichever unit it reads in.
 *
 * One function for both modes, and the return type is what makes that possible: a tick knows
 * where it sits, what to print and how heavy to be, and neither the ruler nor the grid has to
 * know which ladder produced it. They call this SEPARATELY rather than being handed the array —
 * an array prop would be a new identity every render and would defeat the memo that keeps both
 * off the frame path (see the components below).
 *
 * The two ladders differ in kind, not just in scale: bars HALVE (a bar, its beats, half-beats),
 * while time walks 1/2/5/10 per decade and then the minute steps a viewer actually reads. `16s`
 * between labels is not a duration anyone thinks in, which is why `SECOND_TICKS` is a list and
 * not a formula (@studio/ui-timeline/ticks).
 */
export const rulerTicks = (
  mode: RulerMode,
  beatLo: number,
  lastBeat: number,
  unit: number,
  barBeats: number,
  bps: number, // beats per second — the whole of the conversion, since there is no tempo map
  secStep: number,
): RulerTick[] => {
  if (mode === "bars")
    return tickBeats(beatLo, lastBeat, unit).map((b) => {
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
  // From the ORIGIN and not from the first visible second, exactly as `tickBeats` is: a ladder
  // that started where the view does would re-place every line as you panned.
  for (const sec of ticksUpTo(lastBeat / bps, secStep)) {
    const beat = sec * bps;
    if (beat < beatLo - 1e-9) continue;
    const whole = Math.abs(sec - Math.round(sec)) < 1e-6;
    out.push({
      beat,
      index: Math.round(sec / secStep),
      key: `s:${sec}`,
      label: formatClock(sec, secStep),
      // A minute carries the bar's weight and a whole second the beat's, so the eye reads the
      // same three-level rhythm in either unit.
      level: Math.abs(sec % 60) < 1e-6 ? 0 : whole ? 1 : 2,
    });
  }
  return out;
};

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

/**
 * The scale a ruler draws at: its unit, its seconds step, and how many columns per printed
 * number. ONE function, so the timeline and the clip editors cannot pick different ladders for
 * the same zoom.
 *
 * The unit: a bar while a bar fits, then its beats, then halves of a beat as the zoom opens up
 * (see @studio/ui-timeline/ticks). The seconds step is chosen against the widest CLOCK this
 * ruler can print, the bar stride against its widest bar number — measured at the ruler's END
 * rather than on screen, or panning past bar 10 and again past 100 would re-thin every label
 * under the cursor.
 */
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

/**
 * The tick layer, memoised — on the timeline, together with its grid, the most numerous
 * elements on the surface.
 *
 * It is a pure function of the VIEW WINDOW, and every prop here is a number, so React's
 * shallow compare settles it: a re-render of the host for any other reason (a caret move,
 * a poll landing, a meter changing) leaves it untouched. See docs/timeline.md.
 */
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
}: TickProps & {
  ppb: number;
  barStride: number;
}) {
  return (
    <>
      {rulerTicks(mode, beatLo, lastBeat, unit, barBeats, bps, secStep).map(
        (t) => (
          // Three weights, so the coarse line still reads as the bar (or the minute) once the
          // finer ones are drawn between them. Strided on the tick's index from the ORIGIN, or
          // the surviving labels would change as scrolling moved the first one.
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
        ),
      )}
    </>
  );
});

/**
 * The GRID that matches those ticks — the same ladder, one step fainter, drawn across the
 * material instead of in a header of its own.
 *
 * It lives here beside `RulerTicks` rather than in whichever surface draws lanes, because the
 * pair is one statement: a line under the ruler has to be a line the ruler drew, at the weight
 * the ruler gave it. The timeline had this and the piano roll did not — the roll drew bar lines
 * only, hard-coded, so at any zoom past the bar the ruler subdivided and the material below it
 * stayed blank.
 *
 * Memoised for the reason `RulerTicks` is: with the ticks it is the most numerous thing on the
 * surface, every prop is a number, and a re-render of the host for any other reason (a caret
 * move, a poll landing, a meter changing) must leave it untouched. See docs/timeline.md.
 */
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
}: TickProps & {
  ppb: number;
  laneW: number;
  left0: number;
  top: number;
  height: number;
}) {
  return (
    <>
      {rulerTicks(mode, beatLo, lastBeat, unit, barBeats, bps, secStep).map(
        (t) => {
          const left = (t.beat - beatLo) * ppb;
          // A tick at the lane's right edge is a 1px border past the end of the box, and one
          // pixel of horizontal scroll in a view that fits its pane exactly.
          if (left >= laneW) return null;
          return (
            <div
              key={`grid:${t.key}`}
              className={cn(
                "pointer-events-none absolute border-l border-dashed",
                // The ruler's three weights, one step fainter: down here they cross the
                // material rather than sitting in a header of their own.
                t.level === 0
                  ? "border-border/40"
                  : t.level === 1
                    ? "border-border/25"
                    : "border-border/10",
              )}
              style={{ left: left0 + left, top, height }}
            />
          );
        },
      )}
    </>
  );
});

/**
 * The ruler a clip editor stacks over its material: the SONG's positions, not the file's — the
 * tick at "bar 33" is the same bar 33 the timeline shows, because a clip editor is a magnified
 * piece of the arrangement and its header should say where in the song you are looking.
 *
 * `startBeat` is the arrangement beat at the strip's left edge (the clip's placement, window
 * origin included). The ladder stays anchored at the SONG's origin — a clip placed off the bar
 * grid shows its ticks where the song's bars really fall, not renumbered from its own edge.
 *
 * A click seeks the transport to the nearest drawn tick, exactly as the timeline's ruler does —
 * you aimed at a line, not at a pixel — and opening the zoom is how a finer position is reached.
 */
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
