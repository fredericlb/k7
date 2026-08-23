// clipInstances.ts — which materials the song places more than once, and where each one FIRST
// plays. The timeline draws a ghost on every later placement and lights the siblings of the one
// under the caret; both read this. Pure, so "the first is the earliest" can be pinned without a
// pane. See apps/st0/frontend/docs/timeline.md.

import type { WebClip, WebTrack } from "./types";

/** How a placement names its MATERIAL — one spelling, so the clipboard and the ghost badge cannot disagree about which events are copies. */
export const materialOf = (c: WebClip): string => c.name || c.id;

/** Where a material's FIRST placement sits, and how many placements it has in all. */
export interface Instances {
  n: number;
  track: string;
  start: number;
}

/** Every material in the song, by ref: how often it is placed and where the first one is — TRACK lanes only, over the whole song. */
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
        // Strictly earlier, so a tie leaves the one already found — the higher lane, this loop running in the project's track order.
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
