// barWindow.ts — how many bars of a clip are on screen, and which span that is in seconds. Pure,
// because the interesting parts are the edges: a take shorter than the window, and a project whose
// tempo or time signature has not arrived yet.

export interface BarWindow {
  /** Bars actually shown — never more than the take has. */
  shown: number;
  /** How many bars the take spans, rounded up. At least 1, so a very short take still has a window. */
  allBars: number;
  /** The span to draw, in seconds from the start of the file. */
  view: { start: number; end: number };
}

/**
 * The window on a clip: `want` bars of it, or all of it when it is shorter.
 *
 * Anchored at the START and not scrollable, which is the honest description of what this does: the
 * ask was a default that keeps a long take legible, and zooming out is how you reach the rest. A
 * pan would be a second gesture on a surface whose drag already means "select".
 *
 * Guards on tempo and time signature rather than trusting them: both arrive from the compiled doc,
 * which is absent for the first frames after a project opens, and a bar of zero seconds would make
 * every take infinitely many bars long.
 */
export function barWindow(
  seconds: number,
  want: number,
  tempo: number,
  beatsPerBar: number,
): BarWindow {
  const barSec = (Math.max(1, beatsPerBar) * 60) / Math.max(1, tempo);
  const dur = Math.max(0, seconds);
  const allBars = Math.max(1, Math.ceil(dur / barSec));
  const shown = Math.max(1, Math.min(Math.round(want), allBars));
  return {
    shown,
    allBars,
    view: { start: 0, end: Math.min(dur, shown * barSec) },
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
