// anchorRight.ts — a module row's trailing MIXER, lifted out so the host pins it to the pane's right edge.
// The row keeps every other card and cable; the mixer becomes a graph of its own, one BARE card at the
// row's height, so a host fitting both to the same height draws them at the same scale.
// The one thing a reader would get wrong: the cable INTO the mixer is dropped, not redrawn — a pinned
// card no longer sits after the module that feeds it (docs/graphBuild.md).

import { type LaidOutGraph, nodeSize } from "./graph";

/** The row without its last card, and that card alone — or null when the row does not END on a lane's mixer. */
export function splitTrailingMixer(
  row: LaidOutGraph,
): { row: LaidOutGraph; mixer: LaidOutGraph } | null {
  const last = row.nodes[row.nodes.length - 1];
  const before = row.nodes[row.nodes.length - 2];
  // A mixer wears its lane's face (graph.ts); one with nothing before it is the whole row, and stays in it.
  if (!last?.trackFace || !before) return null;
  // `moduleRow` starts its first card one margin in, and ends the row the same margin past its last.
  const margin = row.nodes[0].x - row.left;
  // Sized by its panel alone, the width a bare card needs whatever its header held.
  const w = nodeSize(last.ui).w;
  return {
    row: {
      ...row,
      nodes: row.nodes.slice(0, -1),
      edges: row.edges.filter(
        (e) => e.source !== last.id && e.target !== last.id,
      ),
      width: before.x + before.w + margin,
    },
    // No margin either side: the card is flush with the pane's right edge, and the row keeps its own gap.
    mixer: {
      ...row,
      nodes: [{ ...last, x: row.left, w, bare: true }],
      // Only the automations landing on it: no cable is drawn from a curve not here, but its knobs glow.
      edges: row.edges.filter((e) => e.automation && e.target === last.id),
      width: row.left + w,
    },
  };
}
