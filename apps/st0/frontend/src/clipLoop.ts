// clipLoop.ts — where a clip's LOOP sits on the axis its editor draws, so its editors read the
// same arithmetic. The piano roll is FRAMED on it (rollFit.ts) and its ruler carries the loop brace. The
// waveform strip still spans the placed length and draws the repeat marks — without them the
// material stops partway along a pane whose width nothing on screen explains.

import type { WebClip } from "./types";

/** Beyond this many passes the repeat lines are noise, and a pane cannot show them apart anyway. */
const MAX_MARKS = 256;

export interface ClipLoop {
  /** Where the window that repeats starts, on the pane's own x axis, in beats. */
  from: number;
  /** …and where it ends. */
  to: number;
  /** `to - from`: how long one pass lasts. */
  win: number;
  /** How many times the window plays inside the clip's placed length (>= 1). */
  passes: number;
  /** Where each pass AFTER the first begins, in the same beats — `[]` when it plays once. */
  repeats: number[];
}

/** The loop a clip states, or null: MIDI states it in the NOTES' beats and audio in the SOURCE's, the two panes' axes having different origins. */
export function clipLoop(clip: WebClip): ClipLoop | null {
  const start = clip.loopStart ?? 0;
  const win = (clip.loopEnd ?? 0) - start;
  if (!(win > 0)) return null;
  const from = clip.type === "midi" ? start : 0;
  const to = from + win;
  // The placed length is the window times the count, so this divides out — rounded, and floored at 1: a cut-off pass is a pass.
  const span = clip.length > 0 ? clip.length : win;
  const passes = Math.max(1, Math.round(span / win));
  const repeats: number[] = [];
  for (let k = 1; k < passes && k <= MAX_MARKS; k++)
    repeats.push(from + k * win);
  return { from, to, win, passes, repeats };
}

/** What a MIDI event actually PLAYS, on the roll's own axis: the window when it states one, else the placement's extent; null only when unplaced. */
export function playedZone(clip: WebClip): { from: number; to: number } | null {
  const loop = clipLoop(clip);
  if (loop) return { from: loop.from, to: loop.to };
  return clip.length > 0 ? { from: 0, to: clip.length } : null;
}

/** The repeat lines worth drawing at this scale — 256 passes are a solid grey block, and the window's own edges are never dropped. */
export function visibleRepeats(
  loop: ClipLoop,
  pxPerBeat: number,
  minPx = 6,
): number[] {
  return loop.win * pxPerBeat >= minPx ? loop.repeats : [];
}

/** The same repeats as offsets from the PLACEMENT's start — same arithmetic, different zero, and the wrong one is silently wrong for MIDI. */
export function placedRepeats(
  loop: ClipLoop,
  pxPerBeat: number,
  minPx = 6,
): number[] {
  if (loop.win * pxPerBeat < minPx) return [];
  const out: number[] = [];
  for (let k = 1; k < loop.passes && k <= MAX_MARKS; k++)
    out.push(k * loop.win);
  return out;
}
