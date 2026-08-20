// rackFor.ts — the rack a track's signal reaches: the first rack step in the chain the track
// feeds, following the outs. What decides that a MIDI clip opens as a STEP SEQUENCER rather
// than a piano roll — the rack's symbols are the rows, so without one there is no grid to draw.
// Pure, because which panel a clip opens in is a decision worth pinning.

import type { WebGraph, WebRackSound } from "@studio/graph-model";

/**
 * The sounds of the first rack downstream of `trackId`, or null when its signal never meets one.
 *
 * Walked in signal order — the track's own chain first, then whatever its outs feed — and the
 * FIRST rack wins: it is the one the track's notes land on, and a second rack further down hears
 * that one's audio, not the notes. Bypassed steps still count, deliberately: a bypassed rack
 * still defines the vocabulary the sequence is written in, and editing while muted is normal.
 *
 * Cycle-safe, because a chains file can legally route back to itself through a send.
 */
export function rackFor(
  graph: WebGraph | null | undefined,
  trackId: string,
): WebRackSound[] | null {
  if (!graph || !trackId) return null;
  const chains = graph.chains ?? {};
  const queue = Object.entries(chains)
    .filter(([, c]) => c.from === trackId)
    .map(([name]) => name);
  const seen = new Set<string>(queue);
  while (queue.length) {
    const name = queue.shift();
    const chain = name != null ? chains[name] : undefined;
    if (!chain) continue;
    for (const step of chain.use ?? []) if (step.rack?.length) return step.rack;
    for (const out of chain.out ?? []) {
      if (seen.has(out.to) || !chains[out.to]) continue;
      seen.add(out.to);
      queue.push(out.to);
    }
  }
  return null;
}
