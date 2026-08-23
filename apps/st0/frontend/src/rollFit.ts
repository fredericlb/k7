// rollFit.ts — what the piano roll OPENS on and how far its canvas runs. A clip that states a
// window (`from`/`to`) is FRAMED on it, with a margin of context either side, and the canvas still
// runs over the whole sequence: a window is judged against what lies outside it. Without one,
// frame what is used and run to the placed extent.
// Pure, because this is the arithmetic that decides what a clip appears as.

import type { ClipLoop } from "./clipLoop";
import type { WebNote } from "./types";

/** Breathing room around the fit, as a fraction of the content span. */
export const MARGIN = 0.2;

export interface RollFit {
  /** The pitch range the view frames, clamped to 0..127, and its row count. */
  loKey: number;
  hiKey: number;
  rows: number;
  /** The beat range it frames — the window when the clip states one, else the content + margin. */
  loBeat: number;
  hiBeat: number;
  /** `hiBeat - loBeat`, floored at a bar when unwindowed: what the pane's width is divided by. */
  beats: number;
  /** The clip's whole extent on the timeline — the playhead's bound, NOT what the canvas reaches. */
  placedEnd: number;
  /** How far the canvas runs past `origin`. The window's span when the clip states one. */
  canvasBeats: number;
  /** The beat drawn at the canvas's left edge — the window's `from`, 0 when the clip states none. */
  origin: number;
}

/** The view for one clip: FRAMED on the window with a margin when there is one, else on what is USED — and the canvas stops at the material either way. */
export function rollFit(
  notes: WebNote[],
  clipLength: number,
  barBeats: number,
  loop: ClipLoop | null,
): RollFit {
  const bar = Math.max(1, barBeats);
  const placedEnd =
    clipLength > 0
      ? clipLength
      : Math.max(
          bar,
          notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0),
        );

  // The notes the view is fitted to: those the window contains, or all of them without one.
  const fitNotes = loop
    ? notes.filter((n) => n.time < loop.to && n.time + n.duration > loop.from)
    : notes;

  // An empty range frames C3..C5, which is where a hand goes looking for middle C.
  const keys = fitNotes.map((n) => n.key);
  const loNote = keys.length ? Math.min(...keys) : 48;
  const hiNote = keys.length ? Math.max(...keys) : 72;
  const pMargin = Math.max(
    2,
    Math.round(MARGIN * Math.max(1, hiNote - loNote + 1)),
  );
  const loKey = Math.max(0, loNote - pMargin);
  const hiKey = Math.min(127, hiNote + pMargin);
  const rows = Math.max(1, hiKey - loKey + 1);

  const seqEnd = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);

  if (loop) {
    // The margin is a fraction of the WINDOW: what you want either side of a two-beat window is a beat, not a fifth of a four-minute file.
    const tMargin = Math.max(bar / 2, MARGIN * loop.win);
    return {
      loKey,
      hiKey,
      rows,
      loBeat: Math.max(0, loop.from - tMargin),
      hiBeat: loop.to + tMargin,
      beats: Math.max(bar, loop.to - loop.from + 2 * tMargin),
      placedEnd,
      // Everywhere the wheel may reach, never less than the window, rounded up to a bar so the canvas ends on a line the ruler draws.
      canvasBeats: Math.ceil(Math.max(seqEnd, loop.to, bar) / bar) * bar,
      origin: 0,
    };
  }

  const seqStart = notes.length
    ? notes.reduce((mn, n) => Math.min(mn, n.time), Number.POSITIVE_INFINITY)
    : 0;
  const contentLo = Math.max(0, seqStart);
  const contentHi = Math.max(bar, seqEnd);
  const tMargin = MARGIN * Math.max(bar, contentHi - contentLo);
  const loBeat = Math.max(0, contentLo - tMargin);
  const hiBeat = contentHi + tMargin;

  return {
    loKey,
    hiKey,
    rows,
    loBeat,
    hiBeat,
    beats: Math.max(bar, hiBeat - loBeat),
    placedEnd,
    // Bounded by what the clip IS: eight bars of room past the end put a four-beat clip on a forty-beat canvas nothing would play.
    canvasBeats: Math.ceil(Math.max(seqEnd, placedEnd, bar) / bar) * bar,
    origin: 0,
  };
}
