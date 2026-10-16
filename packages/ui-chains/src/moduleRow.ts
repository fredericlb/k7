// moduleRow.ts — named modules laid out SIDE BY SIDE in the order given, dagre unused, and the two
// passes that line modules up on one rank of the dagre layout instead. See docs/graphBuild.md.

import type { WebGraph } from "@studio/graph-model";
import { buildGraph, withOpenTabs } from "./buildGraph";
import { MIX_OUT, NODE_H, NODE_W, RENDER_OUT } from "./geometry";
import type { GraphNode, LaidOutGraph, RawNode } from "./graphNode";
import type { GridFit } from "./gridFit";

/** Pull the named modules onto ONE rank — the DEEPEST of theirs. See docs/graphBuild.md. */
export function alignModuleRank(
  nodes: RawNode[],
  modules: readonly string[],
): RawNode[] {
  const wanted = new Set(modules);
  const inRow = nodes.filter((n) => n.module && wanted.has(n.module));
  // Nothing to align: one strip is already a row, and none at all leaves the graph as it was.
  if (inRow.length < 2) return nodes;
  const shared = inRow.reduce((r, n) => Math.max(r, n.rank ?? 0), 0);
  return nodes.map((n) => {
    if (n.module && wanted.has(n.module)) return { ...n, rank: shared };
    // …except the SUMS, drawn as sinks but standing where a SOURCE does, so they are not pushed.
    if (
      n.kind === "sink" &&
      n.label !== MIX_OUT &&
      n.label !== RENDER_OUT &&
      (n.rank ?? 0) <= shared
    )
      return { ...n, rank: shared + 1 };
    return n;
  });
}

/** Re-space the named modules along x AFTER layout — equal GAP, the caller's order. See docs/graphBuild.md. */
export function spaceModulesEvenly(
  laid: LaidOutGraph,
  modules: readonly string[],
): LaidOutGraph {
  const byModule = new Map<string, GraphNode>();
  for (const n of laid.nodes)
    if (n.module && !byModule.has(n.module)) byModule.set(n.module, n);
  const row = modules
    .map((name) => byModule.get(name))
    .filter((n): n is GraphNode => !!n);
  if (row.length < 2) return laid;

  // Start where the row already begins, so turning the view on does not carry the cards to the origin.
  let x = Math.min(...row.map((n) => n.x));
  const moved = new Map<string, number>();
  for (const n of row) {
    moved.set(n.id, x);
    x += n.w + STRIP_GAP;
  }
  const right = x - STRIP_GAP;

  return {
    nodes: laid.nodes.map((n) =>
      moved.has(n.id) ? { ...n, x: moved.get(n.id) as number } : n,
    ),
    edges: laid.edges,
    width: Math.max(laid.width, right + ROW_MARGIN),
    height: laid.height,
    // The sweep only moves cards along their own row, so neither end of the drawing moves.
    left: laid.left,
    top: laid.top,
  };
}

/** The room a row makes either side of a card's curve column, px, and the drop of its first curve under the card's top. */
const CURVE_ROOM = 24;
const CURVE_DROP = 24;

/** The gap between two strips in a mixer row, px — wider than dagre's `nodesep` on purpose. */
const STRIP_GAP = 24;
const ROW_MARGIN = 16; // matches layout()'s marginx/marginy, so the two frame alike

/** The named modules laid out SIDE BY SIDE in the order given, dagre unused. See docs/graphBuild.md. */
export function moduleRow(
  graph: WebGraph,
  modules: string[],
  opts: {
    /** Widen each card by this much — elbow room around a fixed-cell grid, not bigger controls. */
    widthScale?: number;
    /** Carry the graph's own CABLES between these modules, and meet them on the sides. */
    links?: boolean;
    /** The LANE this row belongs to: its own card LEADS it, the signal starting there. See docs/graphBuild.md. */
    track?: string;
    /** …and what feeds that lane (`trackInputs`), drawn before its card: the signal starts at the input. */
    inputs?: string[];
    /** Every card at the width the full graph draws it, the lane's clips kept, all of them the tallest's height. */
    asDrawn?: boolean;
    /** The air between two cards, px — 0 makes them touch, -1 GLUES them onto one shared border (rowSeams.ts). */
    gap?: number;
    /** Draw each of the graph's `stacks` as one column, its cards one under another (rowSeams.ts). */
    stack?: boolean;
    /** Draw each card's CURVE cards in a column just before it, the neighbours spaced to make room. */
    curves?: boolean;
    /** What the machine has, for the cards whose panel lists it: an input's sockets, the lenses, the MIDI devices. */
    devices?: Pick<
      NonNullable<Parameters<typeof buildGraph>[1]>,
      "inputDevices" | "cameras" | "midiDevices"
    >;
    /** Hold every card's grid to so many rows or columns — the RESPONSIVE mode (gridFit.ts). */
    fit?: GridFit;
    /** A node that only SAYS where the signal comes from, drawn first and cabled into the first card — a subchain's "input". */
    lead?: { id: string; label: string; sub?: string };
    /** Which of each panel's two shapes to draw — `buildGraph`'s `layout`. */
    layout?: "horizontal" | "vertical";
    /** The tab each card has OPEN, by node id: a card is as wide as that tab (`tabW`), and the row reflows. */
    tabOf?: Record<string, number>;
  } = {},
): LaidOutGraph {
  const {
    widthScale = 1,
    links = false,
    track,
    inputs = [],
    asDrawn = false,
    gap = STRIP_GAP,
    stack = false,
    curves = false,
    devices,
    fit,
    lead,
    tabOf,
    layout,
  } = opts;
  // The same lists the full graph is built with, or its cards' dropdowns would offer nothing here.
  const built = buildGraph(graph, { ...devices, fit, layout });
  // Each card as tall as the page it has open, before the row is laid: a short page must not hold the row's height.
  const nodes = withOpenTabs(built.nodes, tabOf ?? {});
  const { edges } = built;
  const byModule = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes)
    if (n.kind === "module" && n.module && !byModule.has(n.module))
      byModule.set(n.module, n);

  const cards = (names: string[]) =>
    names
      .map((name) => byModule.get(name))
      .filter((n): n is (typeof nodes)[number] => !!n);
  const picked = cards(modules);
  const feeding = track ? cards(inputs) : [];
  // One height for the whole row, the tallest MODULE card's — the lane's own is a clip list taller, and is dropped below.
  const tallest = [...feeding, ...picked].reduce((h, n) => Math.max(h, n.h), 0);
  // Matched on the KIND and not on the name: `trk:` exists so a lane and a module may share one.
  const lane =
    track && (picked.length || feeding.length)
      ? nodes.find((n) => n.kind === "track" && n.module === track)
      : undefined;

  // The signal's origin, as a name and nothing else: a pass-through node, which no menu and no control acts on.
  const head: (typeof nodes)[number] | null =
    lead && !lane && picked.length
      ? {
          id: lead.id,
          label: lead.label,
          sub: lead.sub,
          kind: "chain",
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
          w: NODE_W,
          h: NODE_H,
        }
      : null;
  const row = lane
    ? [...feeding, lane, ...picked]
    : head
      ? [head, ...picked]
      : picked;
  // A STACK — a subchain run in place — is one column, its cards one under another at its own heights.
  const stackOf = new Map<string, number>();
  if (stack)
    (graph.stacks ?? []).forEach((st, i) => {
      for (const m of st) stackOf.set(m, i);
    });
  const stackKey = (n: (typeof row)[number]) =>
    n.module === undefined ? undefined : stackOf.get(n.module);
  const columns: (typeof row)[] = [];
  for (const n of row) {
    const last = columns[columns.length - 1];
    const k = stackKey(n);
    if (last && k !== undefined && stackKey(last[0]) === k) last.push(n);
    else columns.push([n]);
  }
  const columnH = (c: typeof row) => c.reduce((h, n) => h + n.h, 0);
  // As drawn, every lone card is as tall as the tallest column, the lane's clip list included — the row is one band.
  const line = asDrawn
    ? columns.reduce((h, c) => Math.max(h, columnH(c)), 0)
    : tallest;
  const out: GraphNode[] = [];
  const inRow = new Set<string>();
  // Each card's curve cards, by the card they drive — read off the automation edges (docs/graphBuild.md).
  const curvesOf = new Map<string, (typeof nodes)[number][]>();
  if (curves) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const c = e.automation ? byId.get(e.source) : undefined;
      if (c?.kind === "curve")
        curvesOf.set(e.target, [...(curvesOf.get(e.target) ?? []), c]);
    }
  }
  let x = ROW_MARGIN;
  for (const col of columns) {
    // A card's width with its OPEN tab, when its tabs differ — the first one until the host says otherwise.
    const own = (n: (typeof row)[number]) =>
      n.tabW?.[tabOf?.[n.id] ?? 0] ?? n.w;
    const width = (n: (typeof row)[number]) =>
      asDrawn ? own(n) : Math.round(own(n) * widthScale);
    const w = col.reduce((m, n) => Math.max(m, width(n)), 0);
    // Where each card of the column sits, before any x: its curves hang off those tops.
    let y = ROW_MARGIN;
    const tops = col.map((n) => {
      const stacked = col.length > 1;
      const h = stacked ? n.h : asDrawn ? line : tallest;
      const top = stacked ? y : ROW_MARGIN + Math.round((line - h) / 2);
      // A stack's cards share their border too when the row is glued past touching (`gap` < 0).
      y += h + Math.min(0, gap);
      return top;
    });
    // The column's curves first, at its left and under its tops, spaced off both neighbours.
    const hung = col.flatMap((n, i) =>
      (curvesOf.get(n.id) ?? []).map((c, k) => ({ c, top: tops[i], k })),
    );
    if (hung.length) {
      x += CURVE_ROOM;
      const cw = hung.reduce((m, h) => Math.max(m, h.c.w), 0);
      const below = new Map<number, number>();
      for (const { c, top } of hung) {
        const cy = below.get(top) ?? top + CURVE_DROP;
        inRow.add(c.id);
        out.push({ ...c, x, y: cy });
        below.set(top, cy + c.h + CURVE_ROOM / 2);
      }
      x += cw + CURVE_ROOM;
    }
    for (const [i, n] of col.entries()) {
      const stacked = col.length > 1;
      // The lead keeps its own small height, centred on the row: it is a label, not a card to fill the band.
      const h = n === head ? n.h : stacked ? n.h : asDrawn ? line : tallest;
      inRow.add(n.id);
      out.push({
        ...n,
        w,
        h,
        x,
        y: tops[i],
        // Sockets are never PLATED here: the plates are CSS-pinned to edges this row does not use.
        jacks: undefined,
        // …and its event plugs only with its curves: what they fire is not drawn otherwise.
        ...(curves ? {} : { events: undefined }),
        // A lane's mini timeline is the ARRANGEMENT, and it would set the height of every card beside it — docs/graphBuild.md.
        ...(n === lane && !asDrawn
          ? { clips: undefined, clipsMore: undefined }
          : {}),
        ...(links ? { flow: "across" as const } : {}),
        ...(n === head ? { y: ROW_MARGIN + Math.round((line - n.h) / 2) } : {}),
      });
    }
    x += w + gap;
  }
  // The lead's cable into the first card, the one edge no chain file states.
  const first = head ? out.find((n) => n.id !== head.id) : undefined;
  const leadEdges: LaidOutGraph["edges"] =
    links && head && first
      ? [
          {
            id: `${head.id}->${first.id}`,
            source: head.id,
            target: first.id,
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          },
        ]
      : [];
  return {
    nodes: out,
    edges: links
      ? leadEdges.concat(
          edges
            // An automation landing on a card is kept with no curve to start from: its knob glows, and no cable is drawn.
            .filter(
              (e) =>
                inRow.has(e.target) && (inRow.has(e.source) || !!e.automation),
            )
            .map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              label: e.label,
              automation: e.automation,
              signal: e.signal,
              targetPort: e.targetPort,
              sourcePort: e.sourcePort,
              // Two points, which `cablePath` replaces with the sockets it computes from the nodes.
              targetSlot: e.targetSlot, // the same rank, for the path that skips dagre
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
              ],
            })),
        )
      : [],
    width: out.length ? x - gap + ROW_MARGIN : 0,
    // As drawn, the box is the cards' own height and no more, so a height fit makes the tallest fill the view — or a stack of curves, past it.
    height: out.length
      ? Math.max(
          asDrawn ? ROW_MARGIN + line : line + ROW_MARGIN * 2,
          ...out.map((n) => n.y + n.h + (asDrawn ? 0 : ROW_MARGIN)),
        )
      : 0,
    // A row lays itself out from `ROW_MARGIN` and ignores pins entirely: it begins at the origin.
    left: 0,
    top: asDrawn && out.length ? ROW_MARGIN : 0,
  };
}
