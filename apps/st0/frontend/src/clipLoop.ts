// clipLoop.ts — where a clip's LOOP sits on the axis its editor draws, so its editors read the
// same arithmetic. The piano roll is CAGED to it (rollFit.ts): the window is the whole view. The
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

/**
 * The loop a clip states, or null when it states none.
 *
 * WHERE the window sits differs by type, because the two panes' axes have different origins, and
 * the compiler states the pair in whichever space its own material lives in (`nodeProject.ts`):
 *
 * - **midi** — `loopStart`/`loopEnd` are positions in the NOTES, which is exactly the axis the
 *   roll draws them on. A window starting past 0 is why the pair is written even for a clip that
 *   plays once: the notes before it do not sound, and the roll should say so.
 * - **audio** — they are beats into the SOURCE, and the waveform is drawn from the clip's
 *   in-point, which is where the window starts. So the window opens the region: `from` is 0.
 *
 * `0`/`0` means no loop (every ClipDoc carries the fields), and so does any window that does not
 * run forwards.
 */
export function clipLoop(clip: WebClip): ClipLoop | null {
  const start = clip.loopStart ?? 0;
  const win = (clip.loopEnd ?? 0) - start;
  if (!(win > 0)) return null;
  const from = clip.type === "midi" ? start : 0;
  const to = from + win;
  // The placed length is the window times the count, so this divides out. Rounded because the
  // beats are decimals a `to:` was parsed into, and floored at 1: a clip shorter than its own
  // window plays one pass that is cut off, which is a pass.
  const span = clip.length > 0 ? clip.length : win;
  const passes = Math.max(1, Math.round(span / win));
  const repeats: number[] = [];
  for (let k = 1; k < passes && k <= MAX_MARKS; k++)
    repeats.push(from + k * win);
  return { from, to, win, passes, repeats };
}

/**
 * What a MIDI event actually PLAYS, on the roll's own beat axis — or null when nothing is placed.
 *
 * The roll draws it as a band and refuses an edit outside it, so this is the one question every
 * gesture in that pane asks. Two sources, in order:
 *
 * - **the window**, when the clip states one. The notes outside it do not sound.
 * - **the placement's own extent** otherwise. A clip that states no window still plays a length,
 *   and a note past it is not material half-in — it is material nothing sounds.
 *
 * That second case used to be `null`, which drew no band and refused nothing. It was invisible
 * while every windowed clip had a band and every unwindowed one was a sequence you were writing
 * — and it became visible the day `selection consolidate` started producing clips whose window
 * equals their content: the compiler drops the range as saying nothing (`nodeProject.ts`'s
 * `statedTo`), so the band vanished from an event that plainly has an extent.
 *
 * Null only for an UNPLACED clip — a sequence file open in the editor, `length` 0. There is no
 * placement there, so nothing is "what this plays", and the whole file is the material.
 */
export function playedZone(clip: WebClip): { from: number; to: number } | null {
  const loop = clipLoop(clip);
  if (loop) return { from: loop.from, to: loop.to };
  return clip.length > 0 ? { from: 0, to: clip.length } : null;
}

/**
 * The repeat lines worth drawing at this scale, in the same beats.
 *
 * A 1/4-beat window in a 64-beat clip is 256 passes: at any zoom that fits the clip they land on
 * top of each other, and a solid grey block is not information. The pane knows its own pixels per
 * beat, so it asks — and the window's own two edges are never dropped, whatever the scale.
 */
export function visibleRepeats(
  loop: ClipLoop,
  pxPerBeat: number,
  minPx = 6,
): number[] {
  return loop.win * pxPerBeat >= minPx ? loop.repeats : [];
}

/**
 * The same repeats, as offsets from the PLACEMENT's start — which is the timeline's origin.
 *
 * `repeats` is on the EDITOR's axis, and that axis's zero is the MATERIAL's: for a MIDI clip it
 * is the notes' own beats, so a window opening at bar 5 puts the first repeat at `5 + win`. On a
 * lane the zero is the event's left edge, where the k-th pass is simply k windows along. Same
 * arithmetic, different zero, and using the wrong one draws a looping sequence's marks a whole
 * window too far right — silently, and only for MIDI.
 */
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
