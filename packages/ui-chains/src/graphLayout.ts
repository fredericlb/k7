// graphLayout.ts — the dagre layout of a built graph: ranks snapped to rows, the master run set
// aside, frames pushed clear of each other, and nested assemblies laid out inside their frames.
// dagre computes numbers and draws nothing, so what comes out is geometry any renderer consumes.

import dagre from "@dagrejs/dagre";
import {
  curvesLeftOfTargets,
  curvesUnderLeft,
  curveTargets,
  rowSortKey,
} from "./curvePlacement";
import { FRAME_HEAD, FRAME_PAD, MIX_OUT, NODE_H, NODE_W } from "./geometry";
import type {
  GraphEdge,
  GraphNode,
  Kind,
  LaidOutGraph,
  Pt,
  RawEdge,
  RawNode,
} from "./graphNode";

/** Nodes overlapping an OPEN frame step aside by a constant shift per side, recorded nowhere — docs/graphBuild.md. */
export function pushAsideFrames<
  N extends {
    id: string;
    kind: Kind;
    assembly?: string;
    assemblyOf?: { open: boolean };
    x: number;
    y: number;
    w: number;
    h: number;
    pushed?: Pt;
  },
>(nodes: N[]): N[] {
  const frames = nodes.filter(
    (n) => n.kind === "assembly" && n.assemblyOf?.open,
  );
  if (!frames.length) return nodes;
  const moved = new Map<string, number>();
  const at = (n: N): number => n.x + (moved.get(n.id) ?? 0);
  for (const f of frames) {
    const left = f.x - NODE_SEP;
    const right = f.x + f.w + NODE_SEP;
    const mid = f.x + f.w / 2;
    // A member rides with its own frame, and a frame is not pushed by itself.
    const others = nodes.filter(
      (n) => n !== f && !n.assembly && n.y + n.h > f.y && n.y < f.y + f.h,
    );
    const hit = others.filter((n) => at(n) + n.w > left && at(n) < right);
    if (!hit.length) continue;
    // Nearer side, so nothing is dragged across the frame it was beside.
    const goRight = hit.filter((n) => at(n) + n.w / 2 >= mid);
    const goLeft = hit.filter((n) => at(n) + n.w / 2 < mid);
    if (goRight.length) {
      const dx = right - Math.min(...goRight.map(at));
      if (dx > 0)
        for (const n of goRight) moved.set(n.id, (moved.get(n.id) ?? 0) + dx);
    }
    if (goLeft.length) {
      const dx = Math.max(...goLeft.map((n) => at(n) + n.w)) - left;
      if (dx > 0)
        for (const n of goLeft) moved.set(n.id, (moved.get(n.id) ?? 0) - dx);
    }
  }
  if (!moved.size) return nodes;
  return nodes.map((n) => {
    const dx = moved.get(n.id);
    return dx
      ? { ...n, x: n.x + dx, pushed: n.pushed ?? { x: n.x, y: n.y } }
      : n;
  });
}

/** dagre's `marginx`/`marginy`, and the breathing room the measured extent adds back. */
const GRAPH_MARGIN = 16;
/** The gap between one rank's row and the next — dagre's `ranksep`, and the stack's below. */
const RANK_SEP = 70;
/** …and between two siblings side by side, which the row sweep re-uses to part a collision. */
const NODE_SEP = 60;

/** Put every node on the LINE OF ITS OWN RANK after dagre, then sweep for collisions. See docs/graphBuild.md. */
function snapToRankRows(
  placed: GraphNode[],
  // The ranks live on the RAW nodes — a rank is an instruction to the layout, not a fact about the drawing.
  rankOf: Map<string, number>,
  curves: ReadonlyMap<string, string> = new Map(),
): GraphNode[] {
  const ranks = [...new Set(rankOf.values())].sort((a, b) => a - b);
  if (!ranks.length) return placed;

  const rowY = new Map<number, number>();
  let floor = Number.NEGATIVE_INFINITY;
  for (const r of ranks) {
    const of = placed.filter((n) => rankOf.get(n.id) === r);
    if (!of.length) continue;
    const y = Math.max(Math.min(...of.map((n) => n.y)), floor);
    rowY.set(r, y);
    floor = y + Math.max(...of.map((n) => n.h)) + RANK_SEP;
  }
  const snapped = placed.map((n) => {
    const r = rankOf.get(n.id);
    const y = r == null ? undefined : rowY.get(r);
    return y == null ? n : { ...n, y };
  });

  const moved = new Map<string, number>();
  const byId = new Map(snapped.map((n) => [n.id, n]));
  const key = (n: GraphNode) => rowSortKey(n, curves, byId);
  for (const r of ranks) {
    const row = snapped
      .filter((n) => rankOf.get(n.id) === r)
      .sort((a, b) => key(a) - key(b));
    let right = Number.NEGATIVE_INFINITY;
    for (const n of row) {
      const x = Math.max(n.x, right);
      if (x !== n.x) moved.set(n.id, x);
      right = x + n.w + NODE_SEP;
    }
  }
  return moved.size
    ? snapped.map((n) =>
        moved.has(n.id) ? { ...n, x: moved.get(n.id) as number } : n,
      )
    : snapped;
}

/** The MASTER RUN — the sum and what follows it — shifted as a block RIGHT of the rest, the sum on the track row: docs/graphBuild.md. */
export function masterRunAside<
  N extends {
    id: string;
    kind: Kind;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
  },
>(nodes: N[], edges: readonly { source: string; target: string }[]): N[] {
  const sum = nodes.find((n) => n.kind === "sink" && n.label === MIX_OUT);
  if (!sum) return nodes;

  // Everything the master run reaches. The sum is ranked where a SOURCE is, so this walks DOWN.
  const run = new Set([sum.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges)
      if (run.has(e.source) && !run.has(e.target)) {
        run.add(e.target);
        grew = true;
      }
  }
  const others = nodes.filter((n) => !run.has(n.id));
  // A graph that is nothing BUT the master run has no "rest" for it to stand to the right of.
  if (!others.length) return nodes;

  const mine = nodes.filter((n) => run.has(n.id));
  const dx =
    Math.max(...others.map((n) => n.x + n.w)) +
    NODE_SEP -
    Math.min(...mine.map((n) => n.x));
  // …and UP onto the TRACK row beside the lanes it sums — or, with no lane, down past everything.
  const lanes = others.filter((n) => n.kind === "track");
  const dy = lanes.length
    ? Math.min(...lanes.map((n) => n.y)) - sum.y
    : Math.max(...others.map((n) => n.y + n.h)) +
      RANK_SEP -
      Math.min(...mine.map((n) => n.y));
  if (dx === 0 && dy === 0) return nodes;
  return nodes.map((n) =>
    run.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
  );
}

/** Push every receiver below what feeds it, after the pins and only as far as needed, x untouched — docs/graphBuild.md. */
export function pushBelowInputs<N extends { id: string; y: number; h: number }>(
  nodes: N[],
  edges: readonly {
    source: string;
    target: string;
    automation?: unknown;
    signal?: string;
  }[],
): N[] {
  const at = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const waiting = new Map<string, number>();
  for (const e of edges) {
    // A curve drives a param, not the signal, and an event fires one: it sits BESIDE its node, so neither edge pushes anything down.
    if (e.automation || e.signal === "event") continue;
    // A node feeding itself constrains nothing, and would deadlock the walk below.
    if (e.source === e.target || !at.has(e.source) || !at.has(e.target))
      continue;
    (out.get(e.source) ?? out.set(e.source, []).get(e.source))?.push(e.target);
    waiting.set(e.target, (waiting.get(e.target) ?? 0) + 1);
  }
  if (!waiting.size) return nodes;

  const y = new Map(nodes.map((n) => [n.id, n.y]));
  // Kahn: a node's y is final only once every input's is, which is what makes one pass enough.
  const ready = nodes.filter((n) => !waiting.get(n.id)).map((n) => n.id);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    const node = at.get(id);
    if (!node) continue;
    const bottom = (y.get(id) ?? node.y) + node.h;
    for (const to of out.get(id) ?? []) {
      if ((y.get(to) ?? 0) < bottom) y.set(to, bottom);
      const left = (waiting.get(to) ?? 1) - 1;
      waiting.set(to, left);
      if (left === 0) ready.push(to);
    }
  }
  // A node in a CYCLE is left alone, and an unchanged layout hands its own array back (docs/graphBuild.md).
  return nodes.some((n) => y.get(n.id) !== n.y)
    ? nodes.map((n) => {
        const moved = y.get(n.id);
        return moved === undefined || moved === n.y ? n : { ...n, y: moved };
      })
    : nodes;
}

// Position with dagre. It returns centres; we store top-left, edge points staying in absolute graph space.
export function layout(
  nodes: RawNode[],
  raw: RawEdge[],
  // Where somebody PINNED nodes (chains.yaml `positions:`, by chains name) — see docs/graphBuild.md.
  positions?: Record<string, { x: number; y: number }>,
  // Where each node was DRAWN last time, by node id — the host's session memory, outranked by a pin.
  prev?: ReadonlyMap<string, { x: number; y: number }>,
): LaidOutGraph {
  const inside = new Map<string, RawNode[]>();
  for (const n of nodes)
    if (n.assembly) {
      const list = inside.get(n.assembly) ?? [];
      list.push(n);
      inside.set(n.assembly, list);
    }
  return inside.size
    ? layoutNested(nodes, raw, inside, positions, prev)
    : layoutFlat(nodes, raw, positions, prev);
}

/** An OPEN box's members laid out by a RECURSIVE pass, the outer graph seeing one node that size — docs/graphBuild.md. */
function layoutNested(
  nodes: RawNode[],
  raw: RawEdge[],
  inside: Map<string, RawNode[]>,
  positions?: Record<string, { x: number; y: number }>,
  prev?: ReadonlyMap<string, { x: number; y: number }>,
): LaidOutGraph {
  const outerNodes = nodes.filter((n) => !n.assembly);
  const boxIdOf = new Map<string, string>();
  const laidInside = new Map<string, LaidOutGraph>();
  for (const [name, members] of inside) {
    const ids = new Set(members.map((m) => m.id));
    const box = outerNodes.find(
      (n) => n.kind === "assembly" && n.module === name,
    );
    // A member whose box is not on the graph is nobody's; it lays out with everything else.
    if (!box) {
      outerNodes.push(...members);
      continue;
    }
    for (const m of members) boxIdOf.set(m.id, box.id);
    // `assembly` is stripped for the inner pass, or the recursion would look for a box inside itself.
    const laid = layoutFlat(
      members.map((m) => ({ ...m, assembly: undefined })),
      raw.filter((e) => ids.has(e.source) && ids.has(e.target)),
    );
    laidInside.set(name, laid);
    box.w = Math.max(NODE_W, laid.width - laid.left + FRAME_PAD * 2);
    box.h = Math.max(NODE_H, laid.height - laid.top + FRAME_PAD + FRAME_HEAD);
  }
  // dagre is shown the cables as they reach the BOX; the drawing gets them back pointing at the member.
  const seen = new Set<string>();
  const outerEdges: RawEdge[] = [];
  for (const e of raw) {
    const source = boxIdOf.get(e.source) ?? e.source;
    const target = boxIdOf.get(e.target) ?? e.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outerEdges.push({ ...e, id: key, source, target });
  }
  // The push runs BEFORE the members are placed, so a frame that stepped aside takes them with it.
  const outer = pushAsideFrames(
    layoutFlat(outerNodes, outerEdges, positions, prev).nodes,
  );
  const members: GraphNode[] = [];
  for (const [name, laid] of laidInside) {
    const box = outer.find((n) => n.kind === "assembly" && n.module === name);
    if (!box) continue;
    const dx = box.x + FRAME_PAD - laid.left;
    const dy = box.y + FRAME_HEAD - laid.top;
    for (const m of laid.nodes)
      members.push({ ...m, assembly: name, x: m.x + dx, y: m.y + dy });
  }
  const outNodes = [...outer, ...members];
  const placed = new Map(outNodes.map((n) => [n.id, n]));
  const centre = (n: GraphNode): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const outEdges: GraphEdge[] = raw.map((e) => {
    // The two centres, never zero points: the renderer skips an edge with fewer than two (docs/graphBuild.md).
    const src = placed.get(e.source);
    const tgt = placed.get(e.target);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      automation: e.automation,
      signal: e.signal,
      targetPort: e.targetPort,
      sourcePort: e.sourcePort,
      targetSlot: e.targetSlot,
      assembly: e.assembly,
      points: src && tgt ? [centre(src), centre(tgt)] : [],
    };
  });
  const extent = (of: (n: GraphNode) => number): number =>
    outNodes.length ? Math.max(...outNodes.map(of)) + GRAPH_MARGIN : 0;
  const least = (of: (n: GraphNode) => number): number =>
    outNodes.length
      ? Math.min(0, Math.min(...outNodes.map(of)) - GRAPH_MARGIN)
      : 0;

  return {
    nodes: outNodes,
    edges: outEdges,
    width: extent((n) => n.x + n.w),
    height: extent((n) => n.y + n.h),
    left: least((n) => n.x),
    top: least((n) => n.y),
  };
}

function layoutFlat(
  nodes: RawNode[],
  raw: RawEdge[],
  positions?: Record<string, { x: number; y: number }>,
  prev?: ReadonlyMap<string, { x: number; y: number }>,
): LaidOutGraph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    // Signal runs DOWN the page, so `nodesep` and `ranksep` swap axes — see docs/graphBuild.md.
    rankdir: "TB",
    ranker: "longest-path",
    align: "UL",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: 24,
    marginx: GRAPH_MARGIN,
    marginy: GRAPH_MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre must know each node's REAL size: a size it wasn't told is a node its neighbours overlap.
  for (const n of nodes) {
    const attrs: Record<string, unknown> = { width: n.w, height: n.h };
    if (n.rank != null) attrs.rank = n.rank;
    g.setNode(n.id, attrs);
  }
  for (const e of raw) {
    const attrs: Record<string, unknown> = {};
    if (e.weight != null && e.weight > 1) attrs.weight = e.weight;
    g.setEdge(e.source, e.target, attrs, e.id);
  }
  dagre.layout(g);

  const curves = curveTargets(raw, (id) =>
    nodes.some((n) => n.id === id && n.kind === "curve"),
  );
  // A curve's dagre spot is dropped: it goes beside its target, and the row sweep makes the room.
  const placed: GraphNode[] = curvesLeftOfTargets(
    nodes.map((n) => {
      const { x, y } = g.node(n.id);
      // dagre returns a node's CENTRE; everything downstream wants its top-left.
      return { ...n, x: x - n.w / 2, y: y - n.h / 2 };
    }),
    curves,
  );

  let outNodes = snapToRankRows(
    placed,
    new Map(
      nodes.flatMap((n) =>
        typeof n.rank === "number" ? [[n.id, n.rank] as const] : [],
      ),
    ),
    curves,
  );
  // BEFORE the pins: where the master column sits is a preference, and a pin outranks a preference.
  outNodes = masterRunAside(outNodes, raw);
  if (positions || prev) {
    // `jackRef`'s name resolution, inlined because cables.ts imports this file. See docs/graphBuild.md.
    outNodes = outNodes.map((n) => {
      const named =
        n.kind === "module" || n.kind === "assembly"
          ? (n.module ?? n.label)
          : n.label;
      const p = positions?.[named] ?? prev?.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
  }
  // AFTER the pins and the memory: a curve card goes where its target IS, at its left, whatever it was before.
  outNodes = curvesUnderLeft(outNodes, curves);
  // AFTER the pins, because a pin is the only thing that can put a card above what feeds it.
  outNodes = pushBelowInputs(outNodes, raw);
  const outEdges: GraphEdge[] = raw.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    automation: e.automation,
    signal: e.signal,
    // Carried through: dropped, it puts every ported cable on the node's edge, docs/graphBuild.md.
    targetPort: e.targetPort,
    sourcePort: e.sourcePort, // the mirror, and it drops the same way if forgotten here
    targetSlot: e.targetSlot, // ranked in the pass above; without it every bare cable draws to socket 0
    assembly: e.assembly,
    points: g.edge(e.source, e.target, e.id)?.points ?? [],
  }));
  // Measured on the NODES, not read off dagre, and 0 rather than -Infinity when empty. See docs/graphBuild.md.
  const extent = (of: (n: GraphNode) => number): number =>
    outNodes.length ? Math.max(...outNodes.map(of)) + GRAPH_MARGIN : 0;
  // …and the other end, 0 until a pin puts a card above the first row. Never positive.
  const least = (of: (n: GraphNode) => number): number =>
    outNodes.length
      ? Math.min(0, Math.min(...outNodes.map(of)) - GRAPH_MARGIN)
      : 0;
  return {
    nodes: outNodes,
    edges: outEdges,
    width: extent((n) => n.x + n.w),
    height: extent((n) => n.y + n.h),
    left: least((n) => n.x),
    top: least((n) => n.y),
  };
}
