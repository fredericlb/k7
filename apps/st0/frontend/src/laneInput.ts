// laneInput.ts — whether a lane already has an input, audio or MIDI, off the graph document: what
// greys out the per-track view's "audio in" and "midi in" buttons. Walks UPSTREAM from the lane, as
// the server's `runCarriesInput` does, so an input reaching it through a preamp's chain still counts.

import type { WebGraph } from "./types";

/** Does an audio input (`monitor`) or a MIDI device (`device`) feed `track`, directly or through other chains? */
export function laneHasInput(g: WebGraph, track: string): boolean {
  const seen = new Set<string>();
  const todo = [track];
  while (todo.length) {
    const target = todo.pop() as string;
    if (seen.has(target)) continue;
    seen.add(target);
    for (const c of Object.values(g.chains)) {
      if (!c.out?.some((o) => o.to.split("#")[0] === target)) continue;
      if (c.use.some((s) => s.monitor !== undefined || s.device !== undefined))
        return true;
      const head = c.from ?? c.use[0]?.module;
      if (head) todo.push(head);
    }
  }
  return false;
}
