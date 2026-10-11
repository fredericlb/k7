// rackFor.ts — the rack a track's signal reaches: the first rack step in the chain the track
// feeds, following the outs. What decides that a MIDI clip opens as a STEP SEQUENCER rather
// than a piano roll — the rack's symbols are the rows, so without one there is no grid to draw.
// Pure, because which panel a clip opens in is a decision worth pinning.

import type { WebGraph, WebRackSound } from "@studio/graph-model";

/** The sounds of the first rack downstream of `trackId`, or null — walked in signal order, bypassed steps counting, and cycle-safe. */
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

/** Each rack key's name for the roll's key column: its sample's file name, else its clip, else its symbol — several on one key joined. */
export function rackKeyNames(
  rack: readonly WebRackSound[],
): Map<number, string> {
  const names = new Map<number, string>();
  for (const s of rack) {
    // `@<library>/<path>` or a bare path: the file name without its extension is what a musician recognises.
    const file = s.sample
      ?.split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "");
    const name = file || s.clip || s.symbol;
    const had = names.get(s.note);
    names.set(s.note, had ? `${had} / ${name}` : name);
  }
  return names;
}
