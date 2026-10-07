// curvePlacement.ts — a curve card sits at the LEFT of the node it drives, under its top, whether the
// layout is fresh or the other cards keep where they were drawn. dagre knows nothing of an
// automation's meaning and would put a curve anywhere on its row. See docs/graphBuild.md, "Curve cards".

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The gap a curve keeps from its target, and from any card it is tried against. */
const CURVE_GAP = 24;

/** Each curve card's target, read off its automation edge — one binding, one card, one target. */
export function curveTargets(
  edges: readonly { source: string; target: string; automation?: unknown }[],
  isCurve: (id: string) => boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of edges)
    if (e.automation && isCurve(e.source) && !out.has(e.source))
      out.set(e.source, e.target);
  return out;
}

/** The x a row sweep should sort a node by: a curve just before its target, so nothing comes between them. */
export function rowSortKey(
  n: Box,
  targets: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, Box>,
): number {
  const t = byId.get(targets.get(n.id) ?? "");
  return t ? t.x - 1e-3 : n.x;
}

/** Put a fresh curve LEFT of its target on the target's line, ahead of the row sweep that parts collisions. */
export function curvesLeftOfTargets<N extends Box>(
  nodes: N[],
  targets: ReadonlyMap<string, string>,
): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const t = byId.get(targets.get(n.id) ?? "");
    return t ? { ...n, x: t.x - n.w - CURVE_GAP, y: t.y } : n;
  });
}

/** How far below its target's top a curve card starts: under the event plugs on that top edge. */
const CURVE_DROP = 24;

/** Every curve card to the LEFT of its target and under its top, several stacked down — forced, whatever was remembered. */
export function curvesUnderLeft<N extends Box>(
  nodes: N[],
  targets: ReadonlyMap<string, string>,
): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const below = new Map<string, number>();
  const placed = new Map<string, N>();
  for (const n of nodes) {
    const tid = targets.get(n.id);
    const t = tid ? byId.get(tid) : undefined;
    if (!tid || !t) continue;
    const y = below.get(tid) ?? t.y + CURVE_DROP;
    placed.set(n.id, { ...n, x: t.x - n.w - CURVE_GAP, y });
    below.set(tid, y + n.h + CURVE_GAP);
  }
  return placed.size ? nodes.map((n) => placed.get(n.id) ?? n) : nodes;
}

/** The graph with no curve card and no cable touching one — what the zoomed-out view draws (docs/graphBuild.md, "Curve cards"). */
export function withoutCurves<
  G extends {
    nodes: readonly { id: string; kind: string }[];
    edges: readonly { source: string; target: string }[];
  },
>(graph: G): G {
  const curves = new Set(
    graph.nodes.filter((n) => n.kind === "curve").map((n) => n.id),
  );
  if (!curves.size) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !curves.has(n.id)),
    edges: graph.edges.filter(
      (e) => !curves.has(e.source) && !curves.has(e.target),
    ),
  };
}
