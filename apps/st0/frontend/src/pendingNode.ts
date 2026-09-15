// pendingNode.ts — the card a `+` pick draws while its commands run.
// It is the node it announces: that node's size, the place the verb will pin it, its id and its
// cables — so the real card replaces it in place rather than beside it (docs/chainsGraph.md).

import type { WebSignal } from "@studio/graph-model";
import {
  type GraphEdge,
  type GraphNode,
  jackPoint,
  type LaidOutGraph,
  nodeSize,
} from "@studio/ui-chains/graph";

/** A module's panel grid, as the catalogue reports it. */
export interface PanelSize {
  cols: number;
  rows: number;
}

/** A card's top-left and size, in world px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The arrow being spliced, the name the node is created under, and where it will stand. */
export interface PendingNode extends Box {
  before: string;
  after: string;
  node: string;
}

/** Where a node of `panel` must be pinned for its CENTRE to sit on `at` — a pin is a top-left. */
export function spawnBox(at: { x: number; y: number }, panel?: PanelSize): Box {
  const { w, h } = nodeSize(panel ? { ...panel, widgets: {} } : undefined);
  return { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h };
}

/** The id `buildGraph` gives a module node, so the placeholder and the real card are one node to the motion. */
export const pendingNodeId = (node: string): string => `mod:${node}`;

const bare = (ref: string): string => ref.split("#")[0];

/** A node's graph.yaml name, the way an arrow's ends spell it (`jackRef`). */
const nameOf = (n: GraphNode): string =>
  n.kind === "module" || n.kind === "assembly"
    ? (n.module ?? n.label)
    : n.label;

/** `laid` with the pending node standing in the arrow — or `laid` itself once the real graph has spliced it. */
export function withPendingNode(
  laid: LaidOutGraph,
  p: PendingNode,
): LaidOutGraph {
  const a = laid.nodes.find((n) => nameOf(n) === bare(p.before));
  const b = laid.nodes.find((n) => nameOf(n) === bare(p.after));
  if (!a || !b) return laid;
  const id = pendingNodeId(p.node);
  if (laid.edges.some((e) => e.source === a.id && e.target === id)) return laid;
  const arrow = laid.edges.find((e) => e.source === a.id && e.target === b.id);
  const type: WebSignal = arrow?.signal ?? "audio";
  // The first command lands the node unwired: keep ITS card, and draw only the splice still to come.
  const real = laid.nodes.find((n) => n.id === id);
  const card: GraphNode = real ?? {
    id,
    label: p.node,
    module: p.node,
    kind: "module",
    dim: false,
    missing: false,
    stub: false,
    notSupported: false,
    unknownPlugin: false,
    hasNativePluginUI: false,
    pending: true,
    jacks: { in: [{ type, free: false }], out: [{ type, free: false }] },
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
  };
  const into: GraphEdge = {
    id: `${id}:in`,
    source: a.id,
    target: id,
    signal: arrow?.signal,
    sourcePort: arrow?.sourcePort,
    points: [jackPoint(a, "out", 0), jackPoint(card, "in", 0)],
  };
  const out: GraphEdge = {
    id: `${id}:out`,
    source: id,
    target: b.id,
    signal: arrow?.signal,
    targetPort: arrow?.targetPort,
    targetSlot: arrow?.targetSlot,
    points: [jackPoint(card, "out", 0), jackPoint(b, "in", 0)],
  };
  return {
    ...laid,
    nodes: real ? laid.nodes : [...laid.nodes, card],
    edges: [...laid.edges.filter((e) => e !== arrow), into, out],
  };
}
