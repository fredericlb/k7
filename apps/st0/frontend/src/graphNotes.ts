// graphNotes.ts — the graph without its NOTES (`@meta/doc` nodes, listed under `modules`), for a
// view that does not draw them. Filtered before `buildGraph`, or the hole would stay in the layout.

import { splitPort } from "@studio/graph-model";
import type { WebGraph } from "./types";

export function withoutNotes(
  graph: WebGraph,
  notes: ReadonlySet<string>,
): WebGraph {
  if (notes.size === 0) return graph;
  return {
    ...graph,
    chains: Object.fromEntries(
      Object.entries(graph.chains).map(([name, c]) => [
        name,
        {
          ...c,
          use: c.use.filter((s) => !notes.has(s.module)),
          out: (c.out ?? []).filter((o) => !notes.has(splitPort(o.to).node)),
        },
      ]),
    ),
  };
}
