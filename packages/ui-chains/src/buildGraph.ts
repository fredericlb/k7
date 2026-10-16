// buildGraph.ts — a WebGraph turned into unpositioned nodes and edges, mirroring the signal path:
// the lanes, the modules in series, the curves bound to them, the sums and the devices. The steps
// that add cards are buildChains.ts; this file runs them, then types the sockets and ranks the rows.
// The layout places the result afterwards (graphLayout.ts). See docs/graphBuild.md.

import type {
  WebGraph,
  WebModuleUI,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import {
  addChainModules,
  addChainOutputs,
  addChainSource,
  addFreeCurves,
  addOrphanLanes,
  addSums,
  addTapFeeds,
} from "./buildChains";
import { type Build, type BuildOptions, makeBuild } from "./buildContext";
import { jacksFor, nodeSize } from "./geometry";
import type { RawEdge, RawNode } from "./graphNode";
import { fitPanel, type GridFit } from "./gridFit";

export type { BuildOptions } from "./buildContext";

// Build nodes and unpositioned edges from the chain graph, mirroring the signal path. See docs/graphBuild.md.
export function buildGraph(
  graph: WebGraph,
  opts: BuildOptions = {},
): {
  nodes: RawNode[];
  edges: RawEdge[];
} {
  const b = makeBuild(graph, opts);
  for (const [name, c] of Object.entries(graph.chains)) {
    addChainModules(b, name, c);
    addChainSource(b, name, c);
    addChainOutputs(b, name, c);
  }
  addTapFeeds(b);
  addSums(b);
  addOrphanLanes(b);
  // The socket pass needs every cable; the free curves add none, so they may join first.
  const sockets = countSockets(b);
  addFreeCurves(b);
  assignJacks(b, sockets);
  assignRanks(b);

  // The narrow twin first, then the fold for a panel that has none and is still too wide (docs/graphBuild.md).
  if (opts.layout === "vertical")
    for (const n of b.nodes.values()) narrowNode(n);
  // Folded LAST, each card grown or shrunk by what its panel changed, so a lane's clip list keeps its height.
  if (opts.fit) for (const n of b.nodes.values()) fitNode(n, opts.fit);
  // A narrow card is as tall as its OPEN page, not its longest: a short tab under 28 rows of grid is mostly empty.
  if (opts.layout === "vertical")
    for (const n of b.nodes.values()) tabHeights(n);

  return { nodes: [...b.nodes.values()], edges: [...b.edges.values()] };
}

interface Sockets {
  /** Which input ports have a cable, per node. */
  fed: Map<string, Set<string>>;
  /** …and the mirror, per OUTPUT port, so a splitter's wired and spare sockets are told apart. */
  left: Map<string, Set<string>>;
  /** …and how MANY bare cables reach each node, which `fed` cannot say: they all add "". */
  bare: Map<string, number>;
}

// Which sockets have a cable, per node — a last pass, since it needs every edge. docs/graphBuild.md.
function countSockets(b: Build): Sockets {
  const fed = new Map<string, Set<string>>();
  const left = new Map<string, Set<string>>();
  const bare = new Map<string, number>();
  for (const e of b.edges.values()) {
    if (e.automation) continue;
    const at = fed.get(e.target) ?? new Set<string>();
    at.add(e.targetPort ?? ""); // "" is the flow — the first port, and what a bare cable means
    fed.set(e.target, at);
    if (!e.targetPort) {
      // Ranked in the graph's own declaration order, so a cable keeps its socket from one draw to the next.
      e.targetSlot = bare.get(e.target) ?? 0;
      bare.set(e.target, e.targetSlot + 1);
    }
    const from = left.get(e.source) ?? new Set<string>();
    from.add(e.sourcePort ?? "");
    left.set(e.source, from);
  }
  return { fed, left, bare };
}

// What LEAVES a node colours its output jack; an unfed input borrows the cable that reaches it.
function assignJacks(b: Build, { fed, left, bare }: Sockets): void {
  const arriving = new Map<string, WebSignal>();
  const leaving = new Map<string, WebSignal | undefined>();
  for (const e of b.edges.values()) {
    if (e.automation) continue;
    if (e.signal && !arriving.has(e.target)) arriving.set(e.target, e.signal);
    if (!leaving.has(e.source)) leaving.set(e.source, e.signal);
  }
  const NONE: ReadonlySet<string> = new Set();
  for (const n of b.nodes.values()) {
    if (n.kind === "curve") continue; // a curve is a source of automation, not of signal
    // A live INPUT is a SOURCE, and so is the SUM — see docs/graphBuild.md for both reasons.
    const source = n.monitor !== undefined || n.id === b.mixId;
    n.jacks = {
      // A lane takes a feed like anything else, typed by what it puts on the wire.
      in: source
        ? []
        : jacksFor(
            n.inputs,
            fed.get(n.id) ?? NONE,
            arriving.get(n.id) ??
              (n.kind === "track" ? leaving.get(n.id) : undefined),
            true,
            false,
            undefined,
            bare.get(n.id) ?? 0,
          ),
      // A sink has nowhere to leave — except the SUM, where the MASTER RUN begins.
      out:
        n.kind === "sink" && n.id !== b.mixId
          ? []
          : jacksFor(
              n.outputs,
              left.get(n.id) ?? NONE,
              leaving.get(n.id),
              false,
              // A lane's outputs are its SENDS, so a taken one grows a spare. See jacksFor.
              n.kind === "track",
              // …and a lane wired BARE puts its cable on the socket carrying what it holds.
              n.kind === "track"
                ? (b.graph.trackSignals?.[n.label] ?? "audio")
                : undefined,
            ),
    };
  }
}

// dagre rank hints, top to bottom: inputs, tracks, lane modules, the faders, the sum, the master run, sinks — docs/graphBuild.md.
function assignRanks(b: Build): void {
  const { graph, nodes, edges, moduleRank, isSum, moduleId } = b;
  // The modules on a MASTER run, ranked AFTER every lane rather than by their small position inside that run.
  const onMaster = new Set<string>();
  for (const c of Object.values(graph.chains))
    if (isSum(String(c.from ?? "")))
      for (const s of c.use ?? []) onMaster.add(moduleId(s.module));

  const INPUT_RANK = 0;
  const TRACK_RANK = 1;
  const laneRank = new Map<string, number>();
  let masterMax = -1;
  for (const [id, r] of moduleRank)
    if (onMaster.has(id)) masterMax = Math.max(masterMax, r);
    else laneRank.set(id, TRACK_RANK + 1 + r);
  // The lane FADERS share one row, the deepest of theirs, and what follows one in its chain moves down with it.
  const faders = [...laneRank.keys()].filter((id) => nodes.get(id)?.trackFace);
  if (faders.length > 1) {
    const row = Math.max(...faders.map((id) => laneRank.get(id) ?? 0));
    for (const c of Object.values(graph.chains)) {
      if (isSum(String(c.from ?? ""))) continue;
      const use = c.use ?? [];
      const at = use.findIndex((s) => b.mixerOwner.has(s.module));
      for (let i = Math.max(0, at); at >= 0 && i < use.length; i++) {
        const id = moduleId(use[i].module);
        laneRank.set(id, Math.max(laneRank.get(id) ?? 0, row + i - at));
      }
    }
  }
  const laneMax = Math.max(TRACK_RANK, ...laneRank.values());
  // The sum comes after every lane: ranked where a SOURCE is, it sat on the track row and one cable spanned the page.
  const sumRank = laneMax + 1;
  const sinkRank = sumRank + 2 + masterMax;
  for (const n of nodes.values()) {
    if (n.kind === "track") n.rank = TRACK_RANK;
    // A live input FEEDS a lane, so its row is above the tracks — ranked as a module, it pushed its track out of line.
    else if (n.kind === "module" && n.monitor !== undefined)
      n.rank = INPUT_RANK;
    else if (n.id === b.mixId || n.id === b.renderId) n.rank = sumRank;
    else if (n.kind === "module")
      n.rank = onMaster.has(n.id)
        ? sumRank + 1 + (moduleRank.get(n.id) ?? 0)
        : (laneRank.get(n.id) ?? TRACK_RANK + 1);
    else if (n.kind === "sink") n.rank = sinkRank;
    else if (n.kind === "chain") n.rank = TRACK_RANK + 1;
    else if (n.kind === "curve") {
      // Curves sit at the same rank as their target module.
      const targetEdge = [...edges.values()].find(
        (e) => e.source === n.id && e.automation,
      );
      if (targetEdge) {
        const targetRank = nodes.get(targetEdge.target)?.rank;
        if (targetRank != null) n.rank = targetRank;
      }
    }
  }
}

// A card in its NARROW shape: the panel's `vertical` twin when it has one, its own grid otherwise — tabs as a menu either way.
function narrowNode(n: RawNode): void {
  if (!n.ui || n.strip) return;
  const { vertical, ...own } = n.ui;
  const narrow: WebModuleUI = vertical
    ? { ...vertical, script: own.script, tabsAs: "dropdown" }
    : { ...own, tabsAs: "dropdown" };
  const before = nodeSize(n.ui);
  const after = nodeSize(narrow);
  n.ui = narrow;
  n.w += after.w - before.w;
  n.h += after.h - before.h;
}

// Each tab's card height, from the rows its widgets and the shared ones really reach.
function tabHeights(n: RawNode): void {
  const ui = n.ui;
  if (!ui?.tabs?.length || n.strip) return;
  const reach = (ws: Record<string, WebWidget>) =>
    Math.max(
      0,
      ...Object.values(ws).map((w) => w.row + Math.max(1, w.rowSpan ?? 1)),
    );
  const shared = reach(ui.widgets);
  const full = nodeSize(ui).h;
  const hs = ui.tabs.map(
    (t) =>
      n.h +
      nodeSize({ ...ui, rows: Math.max(1, shared, reach(t.widgets)) }).h -
      full,
  );
  if (hs.some((h) => h !== n.h)) n.tabH = hs;
}

/** The nodes sized to the tab each has OPEN, top edge kept: the layout made room for the longest, a card draws only its page. */
export function withOpenTabs<
  N extends { id: string; h: number; tabH?: number[] },
>(nodes: readonly N[], tabOf: Readonly<Record<string, number>>): readonly N[] {
  let changed = false;
  const out = nodes.map((n) => {
    const h = n.tabH?.[tabOf[n.id] ?? 0];
    if (h === undefined || h === n.h) return n;
    changed = true;
    return { ...n, h };
  });
  return changed ? out : nodes;
}

// A strip is left whole: its fader IS its height, and a fader folded beside itself is no strip.
function fitNode(n: RawNode, fit: GridFit): void {
  if (!n.ui || n.strip) return;
  const fitted = fitPanel(n.ui, fit);
  if (fitted === n.ui) return;
  const before = nodeSize(n.ui);
  const after = nodeSize(fitted);
  n.ui = fitted;
  n.w += after.w - before.w;
  n.h += after.h - before.h;
  // …and its width per TAB, each by the same difference: the card is as wide as the page it shows.
  if (fitted.tabs?.some((t) => t.cols !== undefined)) {
    const w = n.w;
    n.tabW = fitted.tabs.map(
      (t) =>
        w + nodeSize({ ...fitted, cols: t.cols ?? fitted.cols }).w - after.w,
    );
  }
}
