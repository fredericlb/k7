// trackPanelLayout.ts — the Graph panel's picture of one track: its subgraph, laid out on its own.
// The thing a reader would get wrong: the Chains tab's pins are NOT applied here. They are places on
// the whole graph's canvas, and a track's slice placed by them is a few cards scattered over all of it.
// See docs/chainsGraph.md.

import type { WebGraph } from "@studio/graph-model";
import {
  buildGraph,
  type LaidOutGraph,
  layout,
  subgraphForTrack,
} from "@studio/ui-chains/graph";

/** One track's path laid out by dagre and the panel's own session memory, or null when nothing routes it. */
export function layoutTrackPanel(
  graph: WebGraph,
  trackId: string,
  opts: Parameters<typeof buildGraph>[1],
  prev?: ReadonlyMap<string, { x: number; y: number }>,
): LaidOutGraph | null {
  const sub = subgraphForTrack(graph, trackId);
  if (!Object.keys(sub.chains).length) return null;
  const { nodes, edges } = buildGraph(sub, opts);
  return layout(nodes, edges, undefined, prev);
}
