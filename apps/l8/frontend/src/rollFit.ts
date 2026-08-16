// rollFit.ts — what the piano roll OPENS on and how far its canvas runs. A clip that states a
// window (`from`/`to`) is CAGED to it: the canvas spans the window and nothing else is drawn.
// Without one, frame what is used with a margin and let the canvas run to the placed extent.
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

/**
 * The view for one clip.
 *
 * **With a window** (`from`/`to` — the loop pair, for MIDI): the view IS the window. Notes outside
 * it do not sound and are not shown, and the later passes of a looped clip are the same picture
 * again — so the canvas stops at the window's end rather than running to the placed extent. The
 * pitch fit reads only the notes the window contains, for the same reason the time axis skips the
 * octaves nothing uses.
 *
 * **Without one**: frame what is USED, with a margin, on both axes — the time axis is the one that
 * had stopped doing so (it framed `[0, clip.length]`; measured on LEMO - DANSE, `da.dub`'s drums
 * opened with their notes filling 7% of the pane) — and let the canvas run to the placed extent.
 */
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

  if (loop) {
    return {
      loKey,
      hiKey,
      rows,
      loBeat: loop.from,
      hiBeat: loop.to,
      beats: loop.win,
      placedEnd,
      canvasBeats: loop.win,
      origin: loop.from,
    };
  }

  const seqEnd = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
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
    canvasBeats: Math.ceil((hiBeat + Math.max(8 * bar, placedEnd)) / bar) * bar,
    origin: 0,
  };
}
