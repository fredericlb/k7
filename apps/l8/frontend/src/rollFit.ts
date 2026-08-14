// rollFit.ts — what the piano roll OPENS on: the span of pitches and the span of beats it frames,
// and how far its canvas runs past them. Pure, because this is the arithmetic that decides whether
// a clip appears zoomed on its content, and it had regressed to the placed extent unnoticed.

import type { ClipLoop } from "./clipLoop";
import type { WebNote } from "./types";

/** Breathing room around the fit, as a fraction of the content span. */
export const MARGIN = 0.2;

export interface RollFit {
  /** The pitch range the view frames, clamped to 0..127, and its row count. */
  loKey: number;
  hiKey: number;
  rows: number;
  /** The beat range it frames — the CONTENT plus its margin. */
  loBeat: number;
  hiBeat: number;
  /** `hiBeat - loBeat`, floored at a bar: what the pane's width is divided by. */
  beats: number;
  /** The clip's whole extent on the timeline — what the canvas must reach, not what it frames. */
  placedEnd: number;
  /** How far the canvas runs, in whole bars. */
  canvasBeats: number;
}

/**
 * The view for one clip.
 *
 * Both axes work the same way — frame what is USED, with a margin, and let the canvas run past it
 * — and the time axis is the one that had stopped doing so. It framed `[0, clip.length]`, and for a
 * LOOPED clip `length` is the window times the count: measured on LEMO - DANSE, `da.dub`'s drums
 * are 7.1 beats of notes in an 80-beat clip, so the roll opened with its content filling 7% of the
 * pane. The loop's window joins the content span, so a pattern whose last hit falls short of the
 * window's end still shows where the loop closes.
 *
 * The canvas still reaches the placed extent, because the later passes are there to be scrolled to.
 */
export function rollFit(
  notes: WebNote[],
  clipLength: number,
  barBeats: number,
  loop: ClipLoop | null,
): RollFit {
  const bar = Math.max(1, barBeats);
  const seqEnd = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
  const seqStart = notes.length
    ? notes.reduce((mn, n) => Math.min(mn, n.time), Number.POSITIVE_INFINITY)
    : 0;

  // An empty sequence frames C3..C5, which is where a hand goes looking for middle C.
  const keys = notes.map((n) => n.key);
  const loNote = keys.length ? Math.min(...keys) : 48;
  const hiNote = keys.length ? Math.max(...keys) : 72;
  const pMargin = Math.max(
    2,
    Math.round(MARGIN * Math.max(1, hiNote - loNote + 1)),
  );
  const loKey = Math.max(0, loNote - pMargin);
  const hiKey = Math.min(127, hiNote + pMargin);

  const contentLo = Math.max(0, Math.min(seqStart, loop?.from ?? seqStart));
  const contentHi = Math.max(bar, seqEnd, loop?.to ?? 0);
  const tMargin = MARGIN * Math.max(bar, contentHi - contentLo);
  const loBeat = Math.max(0, contentLo - tMargin);
  const hiBeat = contentHi + tMargin;

  const placedEnd = clipLength > 0 ? clipLength : Math.max(bar, seqEnd);
  return {
    loKey,
    hiKey,
    rows: Math.max(1, hiKey - loKey + 1),
    loBeat,
    hiBeat,
    beats: Math.max(bar, hiBeat - loBeat),
    placedEnd,
    canvasBeats: Math.ceil((hiBeat + Math.max(8 * bar, placedEnd)) / bar) * bar,
  };
}
