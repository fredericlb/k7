// barWindow.ts — the window of a clip on screen: how many bars, from which bar, and which span
// that is in seconds — inside the REACH the pane may roam (the whole file), with `frameWindow`
// choosing the one it opens on: the event's own window plus a margin of context. Pure, because
// the interesting parts are the edges: a span shorter than the window, a part-bar span, a project
// whose tempo has not arrived yet, and a zoom that must keep the moment under the cursor where
// it is.

/** The interval the clip plays, in seconds of the file — its `from`/`to`, or the whole file. */
export interface BarSpan {
  from: number;
  to: number;
}

export interface BarWindow {
  /** Bars actually shown — never more than the interval has. Fractional under a pinch, which is a
   *  continuous gesture; round it for display. */
  shown: number;
  /** How many bars the interval spans, rounded up. At least 1, so a very short one still has a window. */
  allBars: number;
  /** Seconds one bar spans — what converts an anchor between the two axes. */
  barSec: number;
  /** The span to draw, in seconds from the start of the file. */
  view: { start: number; end: number };
}

/**
 * The window on a clip: `want` bars of its interval starting at `startBar` (bars into the
 * interval), or all of it when it is shorter.
 *
 * The start is CLAMPED here rather than trusted: the wheel hands in whatever keeps its anchor
 * still, and it is this function's job to keep the window on the interval — never before its
 * `from`, never past its `to`.
 *
 * Guards on tempo and time signature rather than trusting them: both arrive from the compiled doc,
 * which is absent for the first frames after a project opens, and a bar of zero seconds would make
 * every take infinitely many bars long.
 */
export function barWindow(
  span: BarSpan,
  want: number,
  tempo: number,
  beatsPerBar: number,
  startBar = 0,
): BarWindow {
  const barSec = (Math.max(1, beatsPerBar) * 60) / Math.max(1, tempo);
  const lo = Math.max(0, span.from);
  const hi = Math.max(lo, span.to);
  const allBars = Math.max(1, Math.ceil((hi - lo) / barSec));
  const shown = Math.min(Math.max(1, want), allBars);
  const start = Math.max(0, Math.min(startBar, allBars - shown));
  return {
    shown,
    allBars,
    barSec,
    view: {
      start: lo + start * barSec,
      end: Math.min(hi, lo + (start + shown) * barSec),
    },
  };
}

/** Bars of context kept either side of the event when the panel opens on it. One bar is enough to
 *  see where the phrase starts from and what runs into it; more and the event stops being framed. */
export const FRAME_MARGIN_BARS = 1;

/**
 * The window the panel OPENS on: the act span, framed inside the reach with `margin` bars of
 * context either side.
 *
 * The two spans are different things and that is the whole point of this function. `reach` is
 * everywhere the pane may roam — the whole file, because a window can only be judged against what
 * lies outside it. `act` is the slice this panel acts on: the event's own window, which is where
 * the trim gate looks and where an onset may be placed. Opening on the reach would put a phrase
 * somewhere in a minute of take; opening on the act alone would frame it with nothing to judge it
 * against, and hide the material a trim would be giving back.
 *
 * Answered in the units `barWindow` takes — a bar count and a start in bars into the reach — so
 * the result is a starting point the wheel then owns, not a second way of describing the view.
 * The start may come back negative or past the end; `barWindow` clamps, and one clamp is enough.
 */
export function frameWindow(
  reach: BarSpan,
  act: BarSpan,
  barSec: number,
  margin = FRAME_MARGIN_BARS,
): { bars: number; start: number } {
  if (!(barSec > 0)) return { bars: 1, start: 0 };
  const from = Math.max(reach.from, act.from);
  const to = Math.min(reach.to, Math.max(act.to, act.from));
  const actBars = Math.max(1, Math.ceil((to - from) / barSec));
  return {
    bars: actBars + 2 * margin,
    start: Math.floor((from - reach.from) / barSec) - margin,
  };
}

/** The next bar count for one wheel notch: out when `deltaY` is positive, in when it is negative.
 *  `+1` on the way out so a one-bar window can still grow — ×1.3 of 1 rounds back to 1. */
export function zoomBars(
  bars: number,
  deltaY: number,
  allBars: number,
): number {
  const next = deltaY > 0 ? bars * 1.3 + 1 : bars / 1.3;
  return Math.max(1, Math.min(allBars, Math.round(next)));
}

/**
 * The start bar that keeps the moment under the cursor where it is, once the window is
 * `nextBars` wide — the same promise `useHZoom` makes on the scrolling panes, restated for a
 * pane that draws a view span instead of scrolling.
 *
 * `frac` is where the cursor sits across the DRAWN span (0..1). The moment under it is a second
 * of the file; after the zoom that second must sit at the same fraction of the new window, which
 * pins the window's start — in bars into the interval, measured from `spanFrom`. Unclamped on
 * purpose — `barWindow` owns the edges.
 */
export function anchorBars(
  view: { start: number; end: number },
  frac: number,
  nextBars: number,
  barSec: number,
  spanFrom = 0,
): number {
  const anchorSec = view.start + frac * (view.end - view.start);
  return (anchorSec - spanFrom) / barSec - frac * nextBars;
}
