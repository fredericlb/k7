// subgraph.ts — one lane's slice of the routing graph: the chains it feeds, the modules on them,
// and the inputs that feed it. Pure reads of a WebGraph, nothing drawn.

import type { WebGraph } from "@studio/graph-model";

// Narrow the graph to one track's signal path — a WebGraph, so `buildGraph` takes it unchanged.
export function subgraphForTrack(graph: WebGraph, track: string): WebGraph {
  const isChain = (n: string) => n in graph.chains;
  const keep = new Set<string>();
  // A chain is downstream of `name` if `name` routes to it (out) or it draws from it (from).
  const walk = (name: string) => {
    if (keep.has(name) || !isChain(name)) return;
    keep.add(name);
    for (const o of graph.chains[name].out) walk(o.to);
    for (const [n, c] of Object.entries(graph.chains))
      if (c.from === name) walk(n);
  };
  for (const [name, c] of Object.entries(graph.chains))
    if (c.from === track) walk(name);

  const chains: Record<string, WebGraph["chains"][string]> = {};
  for (const name of keep) {
    const c = graph.chains[name];
    // A downstream chain fed by ANOTHER track would drag that track in; drop the input, keep the chain we pass through.
    const foreign = c.from && c.from !== track && !isChain(c.from);
    chains[name] = foreign ? { ...c, from: undefined } : c;
  }
  // Carry the colours and curve shapes through, so the panel draws the same curve nodes the full graph does.
  return {
    chains,
    tracks: [track],
    trackColors: graph.trackColors,
    curves: graph.curves,
    warnings: [],
  };
}

/** The modules one track's signal reaches, in the order it reaches them — see docs/graphBuild.md. */
export function trackModules(graph: WebGraph, track: string): string[] {
  const sub = subgraphForTrack(graph, track);
  const seen = new Set<string>();
  const out: string[] = [];
  // The track's own chain first when there is one, so the row starts where the signal does.
  const names = Object.keys(sub.chains).sort((a, b) =>
    sub.chains[a].from === track ? -1 : sub.chains[b].from === track ? 1 : 0,
  );
  for (const name of names)
    for (const step of sub.chains[name].use ?? []) {
      if (!step.module || seen.has(step.module)) continue;
      seen.add(step.module);
      out.push(step.module);
    }
  return out;
}

/** The modules FEEDING one track — its input, and anything between that and the lane — farthest first. */
export function trackInputs(graph: WebGraph, track: string): string[] {
  const seen = new Set<string>();
  // A chain's `from` is a LANE it leaves, never an input, so the walk goes up by each run's first module.
  const upstream = (target: string): string[] => {
    if (seen.has(target)) return [];
    seen.add(target);
    const out: string[] = [];
    for (const c of Object.values(graph.chains)) {
      if (c.from || !c.out?.some((o) => o.to.split("#")[0] === target))
        continue;
      const run = c.use.map((st) => st.module).filter((m): m is string => !!m);
      if (run.length) out.push(...upstream(run[0]), ...run);
    }
    return out;
  };
  return [...new Set(upstream(track))];
}
