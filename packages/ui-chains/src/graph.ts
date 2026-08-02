// graph.ts — the Chains routing graph: model -> nodes/edges -> laid-out geometry.
// Renderer-agnostic on purpose, since dagre computes numbers and draws nothing: what
// comes out is plain geometry any renderer can consume. That split is what let the
// drawing move off Pixi/WebGL to the DOM without touching how the path is derived.

import dagre from "@dagrejs/dagre";
import type {
  WebCurve,
  WebGraph,
  WebModuleCategory,
  WebModuleUI,
  WebSignal,
  WebWidget,
} from "@studio/web-protocol";

// Narrow the graph to one track's signal path: the chains it enters, plus everything reachable downstream.
// Returns a WebGraph, so `buildGraph` takes it unchanged and only the input set differs from the full graph.
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

export type Kind = "track" | "module" | "chain" | "sink" | "curve";

export interface GraphNode {
  id: string;
  label: string;
  sub?: string; // secondary line (the owning chain name on a chain's first module)
  kind: Kind;
  // track only: this lane carries PICTURE. A flag, not a kind — it ranks, links and lays out like an audio lane.
  video?: boolean;
  color?: string; // track only: the track's authored display colour (hex), if any
  chain?: string; // owning chain (modules + empty pass-through chains) — first if shared
  chains?: string[]; // all chains this module belongs to (when shared across chains)
  dim: boolean; // bypassed (module or whole chain)
  module?: string; // the module instance name (for the nativePluginUI open)
  category?: WebModuleCategory; // module only: its type folder — picks the node's icon
  // The chain names a module the project doesn't define: the node exists so you can SEE which name dangles, and where.
  missing: boolean;
  // The library files this module loads, per asset kind — what a library dropdown here shows as its current choice.
  assets?: Record<string, string>;
  stub: boolean; // a plugin module that resolved to no plugin (missing on import)
  notSupported: boolean; // plugin.type is "not_supported" — lanes can't load it (amber)
  unknownPlugin: boolean; // plugin.type is an UNKNOWN format — a typo / unimported (red)
  hasNativePluginUI: boolean; // an external plugin with a nativePluginUI the engine can open
  bypassed?: boolean; // the chain step is `enabled: false` — passes its input through
  // Frozen: on a track, it plays a render of itself; on a module, it is INSIDE that render and so is not running
  // at all. Not `dim` — a bypassed module is still built and can be un-bypassed on the spot, while a frozen one
  // does not exist for the engine until the track is unfrozen.
  frozen?: boolean;
  // A node that does not exist yet: the module being created right now, drawn where it will land. It is not in
  // any graph the server has — the canvas inserts it on the click and drops it when real data arrives.
  pending?: boolean;
  // The module's merged widget grid and the values it shows; a node with one is SIZED to fit it (see nodeSize).
  ui?: WebModuleUI;
  params?: Record<string, number>;
  pluginId?: string; // the engine's PluginDoc id (chain:module), for live param sets
  // io "in" only: whether the interface signal is audible. A module FIELD, not a param, so a widget bound to it
  // needs a target of its own — see DomChains' widgetTarget.
  monitor?: "off" | "auto" | "on";
  // Where this node's waveform listens, when it is not its own plugin's output (an input borrows the lane's).
  tap?: { id: string; side: "input" | "output" };
  // The node's size, per-node because a module's UI decides it — dagre is told these and reserves the real space.
  w: number;
  h: number;
  // Filled in by `layout` — the node's TOP-LEFT in graph space.
  x: number;
  y: number;
}

export interface Pt {
  x: number;
  y: number;
}

// An automation edge's payload: a curve feeding a module's param. Undefined on a signal edge, which is how the
// renderer tells the two apart and draws automations in their own pass.
export interface EdgeAutomation {
  param: string; // the param the curve drives — the edge's label / the fallback text
  // The target widget's node-local centre when the module draws one; absent ⇒ the arrow lands on the border.
  widget?: Pt;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string; // the gain, when not unity
  automation?: EdgeAutomation; // set ⇒ a curve→param link, drawn mauve (see DomChains)
  // What this cable carries, decided by its SOURCE: into an instrument is midi, out of it audio. Undefined ⇒ audio.
  signal?: WebSignal;
  points: Pt[]; // dagre's routed polyline, absolute graph coords
}

export interface LaidOutGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number; // graph extent, for framing the camera
  height: number;
}

// The arrow → `add_to_chain` mapping when a module can be dropped on it; null on an arrow that maps to no `use`
// list. Renderer-agnostic: a renderer reports it when a hovered arrow's `+` is clicked.
export interface EdgeInsert {
  before: string;
  after: string;
}

// A track's live mixer state for its node's widgets (volume in dB, pan 0..1, flags 0/1), on its own channel —
// so a mute toggle repaints one widget instead of relayouting the graph.
export interface TrackControlValues {
  volume: number;
  pan: number;
  mute: number;
  solo: number;
  arm: number;
}

// A node with no UI is this big; one with a UI is sized by its grid. Header + content always, so even "No Options" fits.
export const NODE_W = 160;
export const NODE_H = 70;

// The narrowest a card may be whatever its grid says. Not an aesthetic floor — it is what the header strip needs to
// hold anything at all: 20px of padding, a 13px kind glyph, the 7px gap, and enough left for a few characters of
// the name before the ellipse. Only a one-column panel is narrow enough to meet it.
export const NODE_MIN_W = 72;

// Module-UI grid geometry in graph units, shared with the renderer so hit areas and drawing agree by construction.
// See docs/graphBuild.md for what UI_HEADER and CELL are sized against.
export const CELL = 36;
export const UI_PAD = 6;
export const UI_HEADER = 38;

// How big a node must be to hold `ui`; falls back to the plain size, so a project with no UIs lays out as before.
export function nodeSize(ui?: WebModuleUI): { w: number; h: number } {
  if (!ui?.cols || !ui?.rows) return { w: NODE_W, h: NODE_H };
  return {
    // The grid's width, NOT max(NODE_W, …). NODE_W is what a node with no panel needs to show a name and
    // "No Options"; imposing it on a panelled node just parked dead space to the right of every narrow grid — a
    // 2-column strip is 84px of controls in a 160px card. A panel now says how wide its module is, which is the
    // only thing that knows.
    w: Math.max(NODE_MIN_W, UI_PAD * 2 + ui.cols * CELL),
    h: Math.max(NODE_H, UI_HEADER + UI_PAD * 2 + ui.rows * CELL),
  };
}

// The built-in UI every TRACK node carries — five mixer controls, whose `@` binds are TRACK INTRINSICS the
// renderer routes to the mixer commands. See docs/graphBuild.md.
export const TRACK_UI: WebModuleUI = {
  cols: 3,
  rows: 2,
  widgets: {
    // The three latching buttons share the top row — mute orange, solo yellow, arm red — with the knobs beneath.
    mute: { type: "button", col: 0, row: 0, bind: "@mute", label: "M" },
    solo: { type: "button", col: 1, row: 0, bind: "@solo", label: "S" },
    arm: { type: "button", col: 2, row: 0, bind: "@arm", label: "A" },
    // max 6, not 12: the engine's fader clamps at +6 dB, so a taller knob promised gain it could not deliver.
    vol: {
      type: "knob",
      col: 0,
      row: 1,
      bind: "@volume",
      label: "vol",
      min: -60,
      max: 6,
    },
    pan: {
      type: "knob",
      col: 1,
      row: 1,
      bind: "@pan",
      label: "pan",
      min: 0,
      max: 1,
    },
  },
};

// A VIDEO lane's strip: "mute" means hidden, and a full strip would be four controls that do nothing.
export const VIDEO_TRACK_UI: WebModuleUI = {
  cols: 1,
  rows: 1,
  widgets: {
    mute: { type: "button", col: 0, row: 0, bind: "@mute", label: "M" },
  },
};

// A widget's box in node-local coordinates (origin = the node's top-left).
export function widgetRect(w: WebWidget): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: UI_PAD + w.col * CELL,
    y: UI_HEADER + UI_PAD + w.row * CELL,
    w: Math.max(1, w.colSpan ?? 1) * CELL,
    h: Math.max(1, w.rowSpan ?? 1) * CELL,
  };
}

// A widget's range, defaulting to 0..1 — right for a normalised plugin param, wrong for a built-in in native units.
export const widgetRange = (w: WebWidget): [number, number] => [
  w.min ?? 0,
  w.max ?? 1,
];

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// value ⇄ 0..1 along the travel. `log` needs a strictly positive range, so a min of 0 falls back to linear.
const isLog = (w: WebWidget) => w.curve === "log" && (w.min ?? 0) > 0;

export function widgetNorm(w: WebWidget, value: number): number {
  const [min, max] = widgetRange(w);
  if (max === min) return 0;
  if (isLog(w)) return clamp01(Math.log(value / min) / Math.log(max / min));
  return clamp01((value - min) / (max - min));
}

export function widgetDenorm(w: WebWidget, t: number): number {
  const [min, max] = widgetRange(w);
  const u = clamp01(t);
  const v = isLog(w) ? min * (max / min) ** u : min + (max - min) * u;
  // `step` quantises what the user can reach, not what they see: a param already off-step still displays truly.
  if (!w.step) return v;
  return Math.min(max, Math.max(min, Math.round(v / w.step) * w.step));
}

interface RawNode extends Omit<GraphNode, "x" | "y"> {
  rank?: number; // dagre rank hint — computed from longest chain position
}
interface RawEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  automation?: EdgeAutomation;
  signal?: WebSignal; // what the cable carries — see GraphEdge.signal
  weight?: number; // dagre edge weight — higher pulls endpoints closer
}

// The node-local centre of the widget bound to `param`, or undefined — which decides where an automation arrow lands.
function widgetCenter(
  ui: WebModuleUI | undefined,
  param: string,
): Pt | undefined {
  for (const w of Object.values(ui?.widgets ?? {})) {
    if (w.bind === param) {
      const r = widgetRect(w);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
  }
  return undefined;
}

// A curve node's secondary line: the kind, plus the LFO shape. ASCII only — the BitmapText atlas is the default set.
function curveSubLabel(curve: WebCurve): string {
  return curve.type === "lfo" ? `lfo ${curve.shape ?? "sine"}` : "custom";
}

// Build nodes and unpositioned edges from the chain graph, mirroring the signal path. See docs/graphBuild.md.
export function buildGraph(graph: WebGraph): {
  nodes: RawNode[];
  edges: RawEdge[];
} {
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>(); // keyed by "source->target" so a connection is drawn once

  const isChain = (n: string) => n in graph.chains;
  const isTrack = (n: string) => graph.tracks.includes(n);
  const isVideoTrack = (n: string) => !!graph.videoTracks?.includes(n);
  const trackId = (n: string) => `trk:${n}`;
  const sinkId = (n: string) => `snk:${n}`;
  const moduleId = (mod: string) => `mod:${mod}`;
  const chainId = (chain: string) => `chn:${chain}`;
  const entryId = (chain: string) => {
    const u = graph.chains[chain].use;
    return u.length ? moduleId(u[0].module) : chainId(chain);
  };
  const exitId = (chain: string) => {
    const u = graph.chains[chain].use;
    return u.length ? moduleId(u[u.length - 1].module) : chainId(chain);
  };
  // Every node is the plain size unless it says otherwise — only a module carrying a UI does.
  const add = (
    id: string,
    n: Omit<RawNode, "id" | "w" | "h"> & { w?: number; h?: number },
  ) => {
    if (!nodes.has(id)) nodes.set(id, { id, w: NODE_W, h: NODE_H, ...n });
    else if (n.kind === "module" && n.chains) {
      const existing = nodes.get(id)!;
      const merged = new Set([...(existing.chains ?? []), ...n.chains]);
      existing.chains = [...merged];
      // The sub line names the chains sharing this module, so it must follow the MERGE, not the first insertion.
      existing.sub = merged.size > 1 ? [...merged].join(", ") : undefined;
      // …and so must `frozen`, for the same reason and with worse consequences: it answers "is EVERY chain of
      // this module frozen", and at first insertion only one of them is known. A reverb shared by a frozen track
      // and a live one arrived frozen and stayed that way, greyed out while it was still processing the live one.
      existing.frozen = moduleFrozen(existing.chains);
    }
    return id;
  };
  // The maximum step index a module holds across chains, so a shared one ranks after every pipeline it is in.
  const moduleRank = new Map<string, number>();

  // --- frozen ---------------------------------------------------------------
  // A frozen track's chain is already inside its render, so the engine never builds those plugins: the nodes have
  // to say so, or the graph offers knobs on modules nothing is listening to.
  const frozenTracks = new Set(graph.frozenTracks ?? []);
  // A chain is frozen when the track feeding it is — following `from` through chain-feeds-chain, since a chain
  // sourced from a frozen one carries that render and nothing else. `seen` guards a cycle, same as exitSignal.
  const chainFrozen = (chain: string, seen = new Set<string>()): boolean => {
    const c = graph.chains[chain];
    if (!c || !c.from || seen.has(chain)) return false;
    seen.add(chain);
    if (frozenTracks.has(c.from)) return true;
    return c.from !== chain && isChain(c.from) && !isTrack(c.from)
      ? chainFrozen(c.from, seen)
      : false;
  };
  // …and a MODULE is frozen only when EVERY chain it sits in is. A module shared between a frozen track and a live
  // one still runs for the live one, and marking it asleep would be a plain lie about a node you can still edit.
  const moduleFrozen = (chains: string[]) =>
    chains.length > 0 && chains.every((n) => chainFrozen(n));
  // Add a connection once: the same link can be expressed from either end, so collapse both into one arrow.
  const link = (
    source: string,
    target: string,
    label?: string,
    signal?: WebSignal,
  ) => {
    if (source === target) return; // a chain that feeds itself — skip the degenerate self-loop
    const key = `${source}->${target}`;
    const existing = edges.get(key) ?? edges.get(`${target}->${source}`);
    if (existing) {
      if (!existing.label && label) existing.label = label;
      if (!existing.signal && signal) existing.signal = signal;
      return;
    }
    edges.set(key, { id: key, source, target, label, signal });
  };

  // What leaves a chain — its last module, or for a pass-through whatever reached it. `seen` guards the follow,
  // since a graph being drawn is often one the user is still fixing and must not hang on a cycle.
  const exitSignal = (
    chain: string,
    seen = new Set<string>(),
  ): WebSignal | undefined => {
    const c = graph.chains[chain];
    if (!c || seen.has(chain)) return undefined;
    seen.add(chain);
    if (c.use.length) return c.use[c.use.length - 1].emits;
    if (!c.from) return undefined;
    return isChain(c.from) && !isTrack(c.from)
      ? exitSignal(c.from, seen)
      : graph.trackSignals?.[c.from];
  };

  for (const [name, c] of Object.entries(graph.chains)) {
    const chainOn = c.enabled !== false;
    // Modules of this chain, chained in series.
    c.use.forEach((s, i) => {
      const mid = moduleId(s.module);
      const existing = nodes.get(mid);
      // When the same module appears in multiple chains, merge into one node.
      const chains = existing?.chains
        ? [...new Set([...existing.chains, name])]
        : [name];
      add(mid, {
        label: s.module,
        // Only the SHARED case earns a sub line: editing this module reaches more than one chain. See docs/graphBuild.md.
        sub: chains.length > 1 ? chains.join(", ") : undefined,
        kind: "module",
        chain: chains[0],
        chains,
        dim: !chainOn || s.enabled === false,
        // Distinct from `dim`, which also covers a whole chain: this is THIS step's bypass, which its button flips.
        bypassed: s.enabled === false,
        frozen: moduleFrozen(chains),
        module: s.module,
        category: s.category,
        missing: !!s.missing,
        assets: s.assets,
        stub: !!s.stub,
        notSupported: !!s.notSupported,
        unknownPlugin: !!s.unknownPlugin,
        hasNativePluginUI: !!s.hasNativePluginUI,
        ui: s.ui,
        params: s.params,
        pluginId: s.pluginId,
        monitor: s.monitor,
        tap: s.tap,
        ...nodeSize(s.ui), // a module with a UI is as big as its grid needs
      });
      // Track the maximum position this module occupies across all chains.
      moduleRank.set(mid, Math.max(moduleRank.get(mid) ?? 0, i));
      if (i > 0) {
        const prev = c.use[i - 1];
        const prevId = moduleId(prev.module);
        // The cable between two modules carries what the UPSTREAM one emits — midi into a synth, audio out of it.
        link(prevId, mid, undefined, prev.emits);
        // Within-chain series edges get a higher weight so dagre keeps them tight.
        const e = edges.get(`${prevId}->${mid}`);
        if (e) e.weight = (e.weight ?? 1) + 4;
      }

      // One curve node per binding, so a curve reused by two params draws twice. The edge bypasses link() and carries
      // the automation payload the renderer draws purple.
      for (const a of s.automations ?? []) {
        const curve = graph.curves?.[a.curve];
        if (!curve) continue; // the curve was dropped (missing file) — nothing to draw
        const cid = `aut:${name}:${i}:${a.param}`;
        add(cid, {
          label: a.curve,
          sub: curveSubLabel(curve),
          kind: "curve",
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
        });
        const key = `${cid}->${moduleId(s.module)}`;
        edges.set(key, {
          id: key,
          source: cid,
          target: moduleId(s.module),
          automation: { param: a.param, widget: widgetCenter(s.ui, a.param) },
        });
      }
    });
    if (!c.use.length)
      add(chainId(name), {
        label: name,
        kind: "chain",
        chain: name,
        dim: !chainOn,
        missing: false,
        stub: false,
        notSupported: false,
        unknownPlugin: false,
        hasNativePluginUI: false,
      });

    // A `from` is chain-feeds-chain only when it names a DIFFERENT chain and not a track — both guards matter, and a
    // stale reference used to make the whole track VANISH. See docs/graphBuild.md.
    if (c.from) {
      if (c.from !== name && isChain(c.from) && !isTrack(c.from))
        link(exitId(c.from), entryId(name), undefined, exitSignal(c.from));
      else {
        const video = isVideoTrack(c.from);
        const ui = video ? VIDEO_TRACK_UI : TRACK_UI;
        add(trackId(c.from), {
          label: c.from,
          kind: "track",
          video,
          color: graph.trackColors?.[c.from],
          frozen: frozenTracks.has(c.from),
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
          ui, // the mixer controls; values arrive via setTrackControls
          ...nodeSize(ui), // grow the node to fit its grid
        });
        // A sequences track puts MIDI on the wire, an audio one audio, and a video lane picture whatever trackSignals says.
        link(
          trackId(c.from),
          entryId(name),
          undefined,
          video ? "video" : (graph.trackSignals?.[c.from] ?? "audio"),
        );
      }
    }

    // Outputs: this chain's exit → each target (another chain's entry, or a sink).
    for (const o of c.out) {
      // A destination naming a TRACK lands on the track node itself, not on the first
      // module of that track's chain. That is where a live input's signal actually
      // arrives — ahead of the lane's modules — and it is what `IN:in-2: [ ge.rythm ]`
      // says. Checked before isChain, which says yes to the same name: a track-fed chain
      // is called after its track. Only inputs reach here; every other destination is a
      // bus (named after the module it starts at) or a sink.
      const to = isTrack(o.to)
        ? trackId(o.to)
        : isChain(o.to)
          ? entryId(o.to)
          : add(sinkId(o.to), {
              label: o.to,
              kind: "sink",
              dim: false,
              missing: false,
              stub: false,
              notSupported: false,
              unknownPlugin: false,
              hasNativePluginUI: false,
            });
      link(
        exitId(name),
        to,
        o.gain !== 1 ? `${Math.round(o.gain * 100)}%` : undefined,
        exitSignal(name),
      );
    }
  }

  // Tracks (and video lanes) no chain mentions, drawn as ORPHANS rather than omitted: they still play, and omitting
  // them once hid a batch of renamed tracks entirely. `sub` carries the reason. See docs/graphBuild.md.
  for (const id of [...graph.tracks, ...(graph.videoTracks ?? [])]) {
    const nid = trackId(id);
    if (nodes.has(nid)) continue; // a chain already claimed it
    const video = isVideoTrack(id);
    const ui = video ? VIDEO_TRACK_UI : TRACK_UI;
    add(nid, {
      label: id,
      sub: "no chain",
      kind: "track",
      video,
      color: graph.trackColors?.[id],
      frozen: frozenTracks.has(id),
      dim: false,
      missing: false,
      stub: false,
      notSupported: false,
      unknownPlugin: false,
      hasNativePluginUI: false,
      ui, // the same strip a routed lane of its kind carries
      ...nodeSize(ui),
    });
  }

  // dagre rank hints: tracks 0, modules 1 + their max position, sinks past the deepest, pass-throughs 1.
  let maxModRank = 0;
  for (const r of moduleRank.values()) maxModRank = Math.max(maxModRank, r);
  for (const n of nodes.values()) {
    if (n.kind === "track") n.rank = 0;
    else if (n.kind === "module") n.rank = 1 + (moduleRank.get(n.id) ?? 0);
    else if (n.kind === "sink") n.rank = 2 + maxModRank;
    else if (n.kind === "chain") n.rank = 1;
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

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// Position with dagre and KEEP its routed edge points, so a send that skips a column bends around the module.
// dagre returns centres; we store top-left, while edge points stay in the same absolute graph space.
export function layout(nodes: RawNode[], raw: RawEdge[]): LaidOutGraph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    ranker: "longest-path",
    align: "UL",
    nodesep: 40,
    ranksep: 100,
    edgesep: 24,
    marginx: 16,
    marginy: 16,
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

  const outNodes: GraphNode[] = nodes.map((n) => {
    const { x, y } = g.node(n.id);
    // dagre returns a node's CENTRE; everything downstream wants its top-left.
    return { ...n, x: x - n.w / 2, y: y - n.h / 2 };
  });
  const outEdges: GraphEdge[] = raw.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    automation: e.automation,
    signal: e.signal,
    points: g.edge(e.source, e.target, e.id)?.points ?? [],
  }));
  // dagre reports -Infinity for an empty graph, which `?? 0` never caught and `if (!width)` passed — and framing to
  // it left the view invisible but "already framed". An empty layout has no extent: say 0. See docs/graphBuild.md.
  const { width, height } = g.graph();
  const extent = (v: number | undefined): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return {
    nodes: outNodes,
    edges: outEdges,
    width: extent(width),
    height: extent(height),
  };
}
