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

/**
 * The view for one clip.
 *
 * **With a window** (`from`/`to` — the loop pair, for MIDI): the view is FRAMED on the window, with
 * a margin of context either side, and the canvas runs over the whole sequence. It used to be
 * caged to it — the canvas stopped at the window's end and nothing outside was drawn — which is
 * the same thing the audio clip panel did and the same reason it stopped: a window can only be
 * judged against what lies outside it, and material a window would give back is material you have
 * to be able to see. The pitch fit still reads only the notes the window contains, so a stray note
 * three octaves down cannot squash the pitches that are actually playing.
 *
 * **Without one**: frame what is USED, with a margin, on both axes — the time axis is the one that
 * had stopped doing so (it framed `[0, clip.length]`; measured on LEMO - DANSE, `da.dub`'s drums
 * opened with their notes filling 7% of the pane) — and let the canvas run to the placed extent,
 * and no further. Both branches stop at the material now: writing past the end of what a
 * placement plays produces a note nothing sounds.
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

  const seqEnd = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);

  if (loop) {
    // The margin is a fraction of the WINDOW, not of the sequence: what you want either side of a
    // two-beat window is a beat, not a fifth of a four-minute file.
    const tMargin = Math.max(bar / 2, MARGIN * loop.win);
    return {
      loKey,
      hiKey,
      rows,
      loBeat: Math.max(0, loop.from - tMargin),
      hiBeat: loop.to + tMargin,
      beats: Math.max(bar, loop.to - loop.from + 2 * tMargin),
      placedEnd,
      // Everywhere the wheel may reach: the whole sequence, and never less than the window.
      // Rounded up to a bar so the canvas ends on a line the ruler draws.
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
    // Bounded by what the clip IS, exactly as the windowed branch above is bounded by its
    // sequence — never past it. It used to add eight bars of room to write in beyond the end,
    // which put a four-beat clip on a forty-beat canvas: nine empty bars you could roam into and
    // drop a note that the placement would never play. A note outside the extent is not material
    // half-in, it is material that does not sound.
    canvasBeats: Math.ceil(Math.max(seqEnd, placedEnd, bar) / bar) * bar,
    origin: 0,
  };
}
