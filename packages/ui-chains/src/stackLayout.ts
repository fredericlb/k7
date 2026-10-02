// stackLayout.ts — the graph as STACKS: one column per lane — the inputs that feed it, its own card,
// then every module on its path — edge to edge and all as wide as the widest; what no lane reaches a
// column per chain; and LAST, the MIX with the master run and OUT under it. No dagre: the order is the
// song's, and a column is read top to bottom.
// The one thing a reader would get wrong: nothing here is pinned or remembered — it is an arrangement
// of the same graph, like the mixer row (docs/graphBuild.md).

import type { WebGraph } from "@studio/graph-model";
import type { GraphNode, LaidOutGraph, RawEdge, RawNode } from "./graph";
import { trackModules } from "./graph";

/** The air around the stacks, between two columns, and between a column's inputs and its head. */
const STACK_MARGIN = 16;
const STACK_COL_GAP = 24;
const STACK_INPUT_GAP = 24;

/** The sum, which heads the last column, the master run and OUT under it. */
const MIX = "MIX";

/** A SOURCE the graph starts from — a live input, a lens, a MIDI device: drawn over the lane it feeds. */
const isInput = (n: RawNode): boolean =>
  n.kind === "module" &&
  (n.monitor !== undefined || n.camera !== undefined || n.device !== undefined);

/** One column: the inputs over its head, then the head and what is stacked under it. */
interface Column {
  inputs: RawNode[];
  body: RawNode[];
}

/** The stack arrangement of an already-built graph: lanes in `trackOrder`, whatever no lane reaches, the MIX last. */
export function stackLayout(
  nodes: RawNode[],
  edges: RawEdge[],
  graph: WebGraph,
  trackOrder: readonly string[],
): LaidOutGraph {
  const byModule = new Map<string, RawNode>();
  for (const n of nodes)
    if (n.module && !byModule.has(n.module)) byModule.set(n.module, n);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Set<string>();
  const columns: Column[] = [];
  const take = (n: RawNode | undefined, into: RawNode[]): void => {
    if (!n || placed.has(n.id) || isInput(n)) return;
    into.push(n);
    placed.add(n.id);
  };

  // One column per LANE, in the song's order: the inputs feeding it, its own card, each module on its path once.
  const lanes = nodes
    .filter((n) => n.kind === "track")
    .sort(
      (a, b) =>
        order(trackOrder, a.module ?? a.label) -
        order(trackOrder, b.module ?? b.label),
    );
  for (const lane of lanes) {
    const col: Column = { inputs: [], body: [] };
    take(lane, col.body);
    for (const m of trackModules(graph, lane.module ?? lane.label))
      take(byModule.get(m), col.body);
    for (const e of edges) {
      const src = byId.get(e.source);
      if (e.target === lane.id && src && isInput(src) && !placed.has(src.id)) {
        col.inputs.push(src);
        placed.add(src.id);
      }
    }
    columns.push(col);
  }

  // The MIX's column, kept for LAST: the master run — the chain out of it — then where it lands, OUT.
  const mixCol: Column = { inputs: [], body: [] };
  const mix = nodes.find((n) => n.kind === "sink" && n.label === MIX);
  if (mix) {
    take(mix, mixCol.body);
    const sink = (to: string) =>
      nodes.find((n) => n.kind === "sink" && n.label === to);
    for (const c of Object.values(graph.chains))
      if (c.from === MIX) {
        for (const s of c.use ?? []) take(byModule.get(s.module), mixCol.body);
        for (const o of c.out ?? []) take(sink(o.to), mixCol.body);
      }
  }

  // What no lane reaches — a bus, a curve, a note, CUE — a column per chain, in drawing order.
  const rest = new Map<string, RawNode[]>();
  for (const n of nodes) {
    if (placed.has(n.id) || isInput(n)) continue;
    const key = n.chain ?? n.id;
    rest.set(key, [...(rest.get(key) ?? []), n]);
  }
  for (const body of rest.values()) columns.push({ inputs: [], body });
  // …an input feeding no lane in a column of its own…
  for (const n of nodes)
    if (isInput(n) && !placed.has(n.id))
      columns.push({ inputs: [n], body: [] });
  // …and the MIX's, always the last: the sum is where every column ends up.
  if (mixCol.body.length) columns.push(mixCol);

  const widths = columns.map((c) =>
    [...c.inputs, ...c.body].reduce((w, n) => Math.max(w, n.w), 0),
  );
  const out: GraphNode[] = [];
  // Sockets are never PLATED: a plate hangs off the card's edge, onto the card stacked against it.
  const place = (
    n: RawNode,
    x: number,
    y: number,
    w: number,
    bar?: boolean,
  ): number => {
    const { rank: _rank, ...rest } = n;
    out.push({
      ...rest,
      x,
      y,
      w,
      jacks: undefined,
      ...(bar ? { bar: true } : {}),
    });
    return y + n.h;
  };

  // Every column's head on ONE line, under the tallest pile of inputs any column carries.
  const pile = (c: Column) => c.inputs.reduce((s, n) => s + n.h, 0);
  const inputsH = columns.reduce((h, c) => Math.max(h, pile(c)), 0);
  const head = STACK_MARGIN + (inputsH ? inputsH + STACK_INPUT_GAP : 0);
  let x = STACK_MARGIN;
  let bottom = head;
  columns.forEach((c, i) => {
    // The inputs sit right over their lane, as wide as its column, and end where the column begins.
    let iy = head - (inputsH ? STACK_INPUT_GAP : 0) - pile(c);
    for (const n of c.inputs) iy = place(n, x, iy, widths[i], true);
    let cy = head;
    for (const n of c.body) cy = place(n, x, cy, widths[i]);
    bottom = Math.max(bottom, cy);
    x += widths[i] + STACK_COL_GAP;
  });

  // A card forking to more than one place keeps its OUTPUT sockets, so each cable leaves from its own.
  const leaving = new Map<string, number>();
  for (const e of edges)
    if (!e.automation) leaving.set(e.source, (leaving.get(e.source) ?? 0) + 1);
  for (const n of out) {
    const jacks = byId.get(n.id)?.jacks;
    if ((leaving.get(n.id) ?? 0) > 1 && jacks)
      n.jacks = { in: [], out: jacks.out };
  }
  // A cable between two cards of one column that are not stacked against each other SKIPS the cards
  // between them: it goes round on the column's right side, each in a lane of its own.
  const at = new Map(out.map((n) => [n.id, n]));
  const lanesUsed = new Map<number, number>();
  const sideOf = (e: RawEdge): number | undefined => {
    const src = at.get(e.source);
    const tgt = at.get(e.target);
    if (!src || !tgt || e.automation || src.bar || src.x !== tgt.x)
      return undefined;
    if (tgt.y === src.y + src.h) return undefined;
    const lane = lanesUsed.get(src.x) ?? 0;
    lanesUsed.set(src.x, lane + 1);
    return lane;
  };

  return {
    nodes: out,
    edges: edges.map((e) => ({
      id: e.id,
      assembly: e.assembly,
      source: e.source,
      target: e.target,
      label: e.label,
      automation: e.automation,
      signal: e.signal,
      targetPort: e.targetPort,
      sourcePort: e.sourcePort,
      targetSlot: e.targetSlot,
      side: sideOf(e),
      // Two points, which `cablePath` replaces with the sockets it computes from the nodes.
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    })),
    width: columns.length ? x - STACK_COL_GAP + STACK_MARGIN : 0,
    height: bottom + STACK_MARGIN,
    left: 0,
    top: 0,
  };
}

/** A lane's place in the song's order; a lane the order does not name goes last. */
function order(trackOrder: readonly string[], id: string): number {
  const i = trackOrder.indexOf(id);
  return i < 0 ? trackOrder.length : i;
}
