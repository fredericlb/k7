// clipInstances.ts — which materials the song places more than once, and where each one FIRST
// plays. The timeline draws a ghost on every later placement and lights the siblings of the one
// under the caret; both read this. Pure, so "the first is the earliest" can be pinned without a
// pane. See apps/st0/frontend/docs/timeline.md.

import type { WebClip, WebTrack } from "./types";

/**
 * How a placement names its MATERIAL: the ref `events add` takes, and what makes two placements
 * "the same clip".
 *
 * One spelling, exported rather than repeated, so the clipboard and the ghost badge cannot come
 * to disagree about which events are copies of each other.
 */
export const materialOf = (c: WebClip): string => c.name || c.id;

/** Where a material's FIRST placement sits, and how many placements it has in all. */
export interface Instances {
  n: number;
  track: string;
  start: number;
}

/**
 * Every material in the song, by ref: how many times it is placed, and where the first one is.
 *
 * A fact about the SONG rather than about the view, so callers hand it every track and not the
 * drawn rows: zooming into three lanes must not un-ghost an event because the copy it repeats is
 * on the fourth, and a repeat off the left edge is still a repeat.
 *
 * TRACK lanes only, and the exclusions are the whole judgement here. A take holds what its lane
 * was playing, which is the same material by construction — counting takes would ghost every
 * event on every lane ever recorded over. A generated lane's clips are the scheduler's
 * look-ahead rather than placements anybody wrote. Video lanes are a material space of their own.
 *
 * FIRST is the earliest in time, ties broken by lane order and then by the lane's own. Two
 * placements on one beat still have to have a first, and "the one nearer the top" is the only
 * answer a person can check by looking.
 */
export function materialInstances(
  tracks: readonly WebTrack[],
): Map<string, Instances> {
  const out = new Map<string, Instances>();
  for (const t of tracks) {
    if (t.generated) continue;
    for (const c of t.clips) {
      const at = out.get(materialOf(c));
      if (!at) out.set(materialOf(c), { n: 1, track: t.id, start: c.start });
      else {
        at.n++;
        // Strictly earlier, so an exact tie leaves the one already found — which is the one on
        // the higher lane, this loop being in the project's own track order.
        if (c.start < at.start - 1e-9) {
          at.track = t.id;
          at.start = c.start;
        }
      }
    }
  }
  return out;
}

/** Is this the placement `inst` calls the first — the one that wears no ghost? */
export const isFirstPlacement = (
  inst: Instances | undefined,
  trackId: string,
  start: number,
): boolean =>
  !!inst && inst.track === trackId && Math.abs(inst.start - start) < 1e-6;
