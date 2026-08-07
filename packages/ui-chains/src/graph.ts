// graph.ts — the Chains routing graph: model -> nodes/edges -> laid-out geometry.
// Renderer-agnostic on purpose, since dagre computes numbers and draws nothing: what
// comes out is plain geometry any renderer can consume. That split is what let the
// drawing move off Pixi/WebGL to the DOM without touching how the path is derived.

import dagre from "@dagrejs/dagre";
import type {
  WebCc,
  WebCurve,
  WebGraph,
  WebModuleCategory,
  WebModuleUI,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import { splitPort } from "@studio/graph-model";

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
  notSupported: boolean; // plugin.type is "not_supported" — l8 can't load it (amber)
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
  // Which MIDI CC plays which of its params, keyed by the widget's `bind` — the module's own map
  // (its folder's `controller.yaml`), so every instance of it answers to the same controls.
  cc?: Record<string, WebCc>;
  /** The module's input ports, when it has more than one. What lets the node draw a jack each,
   *  so a cable naming `#b` can land on `b` rather than on the node's edge. */
  inputs?: { name: string; type: WebSignal; mandatory?: boolean }[];
  /** …and its outputs, when it has more than one. */
  outputs?: { name: string; type: WebSignal }[];
  /** The sockets to DRAW, already decided — see `jacksFor`. Computed here rather than in the
   *  renderer because how many a node shows depends on what is wired to it, which is a fact
   *  about the graph and not about the DOM. */
  jacks?: { in: Jack[]; out: Jack[] };
  // A STRING value is a file-valued param (`nam`): drawn as a dropdown over the module's own
  // assets/ rather than a knob, and never sent to the engine as a param.
  params?: Record<string, number | string>;
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

/** One socket on a node's edge. `name` is absent for the single port every module has — there is
 *  nothing to disambiguate, and calling it "in" would be noise on every node in the song. */
export interface Jack {
  name?: string;
  type: WebSignal;
  /** Nothing is wired to it. Drawn hollow: an invitation, not a connection. */
  free: boolean;
}

/**
 * The sockets a node shows, from what it declares and what is already plugged into it.
 *
 * Inputs REVEAL THEMSELVES: every mandatory port is drawn from the start (a socket that must be
 * fed is a thing to say up front), and past those exactly one free jack appears beyond the last
 * occupied one — so a crossfade with one side wired shows the second, and a module with five
 * optional ports does not present five empty holes to a reader who is using two. Never more than
 * the module declares, and never fewer than one: every node has somewhere for signal to arrive.
 *
 * Outputs do not: all of them show at once. An output is offered, never required, so there is no
 * progression to disclose — the question "what can I take off this module" wants one answer.
 */
export function jacksFor(
  ports: { name: string; type: WebSignal; mandatory?: boolean }[] | undefined,
  fed: ReadonlySet<string>,
  fallback: WebSignal | undefined,
  grow: boolean,
): Jack[] {
  // A module that declares nothing has the one port every module has, typed by what it handles.
  if (!ports?.length) return [{ type: fallback ?? "audio", free: !fed.size }];
  const isFed = (p: { name: string }, i: number) =>
    fed.has(p.name) || (i === 0 && fed.has(""));
  // Outputs, which show all at once and read their occupancy the same way inputs do: the edge
  // now carries which jack it left from (`sep#vocals: [ reverb ]`), so a separator with three
  // stems wired and one spare says so. `""` is a cable that named no port — the first output,
  // and what every cable drawn before source ports existed means.
  if (!grow)
    return ports.map((p, i) => ({
      name: p.name,
      type: p.type,
      free: !isFed(p, i),
    }));
  const mandatory = ports.filter((p) => p.mandatory !== false).length;
  // One past the LAST occupied port, not one past the count: a module fed only on `b` still has
  // to show `a`, or the empty socket the cable came from would vanish from under it.
  let lastFed = -1;
  ports.forEach((p, i) => {
    if (isFed(p, i)) lastFed = i;
  });
  const shown = Math.min(ports.length, Math.max(1, mandatory, lastFed + 2));
  return ports
    .slice(0, shown)
    .map((p, i) => ({ name: p.name, type: p.type, free: !isFed(p, i) }));
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
  /** Which INPUT of the target this cable lands on, when the destination named one
   *  (`crossfade#b`). Undefined ⇒ the flow, which is the target's first input and what every
   *  cable drawn before ports existed means. See `@studio/song`'s docs/ports.md. */
  targetPort?: string;
  /** …and which OUTPUT of the source it left from, when the chains file keyed one
   *  (`sep#vocals: [ reverb ]`). Undefined ⇒ the first output, which is every module that has
   *  only one. The mirror of `targetPort`, and what makes a splitter drawable. */
  sourcePort?: string;
  points: Pt[]; // dagre's routed polyline, absolute graph coords
}

/**
 * The centre of one socket, in graph space — where a cable ends.
 *
 * The sockets are spread evenly down the node's edge (a third and two thirds for two), matching the `top`
 * the renderer sets on each plate: one rule, so the cable meets the hole rather than landing near it.
 */
export function jackPoint(n: GraphNode, side: "in" | "out", index: number): Pt {
  const count = Math.max(1, (n.jacks?.[side] ?? []).length);
  const i = Math.min(Math.max(0, index), count - 1);
  return {
    x: side === "in" ? n.x - PORT_PLATE / 2 : n.x + n.w + PORT_PLATE / 2,
    y: n.y + (n.h * (i + 1)) / (count + 1),
  };
}

/**
 * A cable's polyline: dagre's routing with both ends moved onto the SOCKETS they plug into.
 *
 * dagre routes to the node's BORDER, which was right while a cable ended in an arrowhead pointing at a card.
 * A cable ends in a plug, and a plug goes in a hole — so the endpoints are replaced and a short straight lead
 * is added at each, which is what makes it leave the plate square instead of curving off it at an angle. The
 * waypoints in between are dagre's, untouched: it is what keeps a send bending around the module it skips.
 *
 * Both sockets are the ones the cable NAMES — `crossfade#b` for the jack it arrives at, `sep#vocals` for the
 * one it leaves — each matched against that node's jack list. A name that matches nothing falls back to the
 * first jack rather than dropping the cable: an unroutable edge is still an edge worth seeing.
 */
export function cablePath(
  e: GraphEdge,
  src: GraphNode | undefined,
  tgt: GraphNode | undefined,
): Pt[] {
  const pts = e.points;
  if (pts.length < 2) return pts;
  const mid = pts.slice(1, -1);
  const fromIndex = e.sourcePort
    ? (src?.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? -1)
    : 0;
  const from = src
    ? jackPoint(src, "out", fromIndex < 0 ? 0 : fromIndex)
    : pts[0];
  const toIndex = e.targetPort
    ? (tgt?.jacks?.in.findIndex((j) => j.name === e.targetPort) ?? -1)
    : 0;
  const to = tgt
    ? jackPoint(tgt, "in", toIndex < 0 ? 0 : toIndex)
    : pts[pts.length - 1];
  return [
    from,
    { x: from.x + PORT_LEAD, y: from.y },
    ...mid,
    { x: to.x - PORT_LEAD, y: to.y },
    to,
  ];
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

// A port's plate — the little step off the card's edge a socket is mounted in. Here rather than in the
// stylesheet because a cable has to END at the socket, so the drawing and the CSS have to agree on where it
// is; the renderer interpolates this into the sheet so there is one number and not two.
export const PORT_PLATE = 13;
// How far a cable runs straight out of a socket before it starts bending, so it leaves the plate square on
// the way a real one does. Purely cosmetic, and small enough not to fight dagre's routing.
export const PORT_LEAD = 16;

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
  targetPort?: string; // which INPUT of the target it lands on — see GraphEdge.targetPort
  sourcePort?: string; // …and which OUTPUT it left from — see GraphEdge.sourcePort
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
    targetPort?: string,
    sourcePort?: string,
  ) => {
    if (source === target) return; // a chain that feeds itself — skip the degenerate self-loop
    const key = `${source}->${target}`;
    const existing = edges.get(key) ?? edges.get(`${target}->${source}`);
    if (existing) {
      if (!existing.label && label) existing.label = label;
      if (!existing.signal && signal) existing.signal = signal;
      if (!existing.targetPort && targetPort) existing.targetPort = targetPort;
      if (!existing.sourcePort && sourcePort) existing.sourcePort = sourcePort;
      return;
    }
    edges.set(key, {
      id: key,
      source,
      target,
      label,
      signal,
      targetPort,
      sourcePort,
    });
  };

  // Every module that appears as a step somewhere. A side input's target is normally one of
  // these rather than a chain of its own: a single flow feeder keeps it absorbed into that run.
  const usedModules = new Set<string>();
  for (const c of Object.values(graph.chains))
    for (const s of c.use) usedModules.add(s.module);

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
        cc: s.cc,
        params: s.params,
        // Carried to the node so it can draw a jack per port — see DomChains. Absent for the
        // single-port majority, which draws the one jack it always did.
        inputs: s.inputs,
        outputs: s.outputs,
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
      // A destination may name a PORT (`crossfade#b`) — a side input, feeding something other
      // than the target's first. The node is what the cable lands on; the port decides WHICH
      // jack. Split before any of the tests below, or a ported ref matches none of them and
      // falls through to `sinkId`, inventing a sink node called "crossfade#b".
      const { node: toNode, port: toPort } = splitPort(o.to);
      const to = isTrack(toNode)
        ? trackId(toNode)
        : isChain(toNode)
          ? entryId(toNode)
          : // A module that is a STEP inside someone else's chain — which is what a side input's
            // target usually is, since one flow feeder keeps it absorbed. It has a node already.
            usedModules.has(toNode)
            ? moduleId(toNode)
            : add(sinkId(toNode), {
                label: toNode,
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
        toPort,
        o.fromPort,
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

  // --- sockets --------------------------------------------------------------
  // Which input ports actually have a cable, per node. A last pass because it needs every edge:
  // a module is fed from its own chain AND from whatever routes into it from elsewhere, and the
  // second kind is only known once every chain has been walked. An automation arrow is not a
  // signal and occupies no jack — a curve drives a knob, it does not plug into the module.
  const fed = new Map<string, Set<string>>();
  // …and the mirror, per OUTPUT port. Both halves are per-socket now: a module that splits
  // across its outputs has some wired and some spare, and one bit for the whole node could not
  // tell them apart.
  const left = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    if (e.automation) continue;
    const at = fed.get(e.target) ?? new Set<string>();
    at.add(e.targetPort ?? ""); // "" is the flow — the first port, and what a bare cable means
    fed.set(e.target, at);
    const from = left.get(e.source) ?? new Set<string>();
    from.add(e.sourcePort ?? "");
    left.set(e.source, from);
  }
  // What LEAVES a node decides its output jack's colour; what its first input takes is not on the
  // step (a module says what it emits, not what it eats), so an unfed input borrows the cable that
  // reaches it. Neither is load-bearing: a jack with no signal to claim stays neutral.
  const arriving = new Map<string, WebSignal>();
  const leaving = new Map<string, WebSignal | undefined>();
  for (const e of edges.values()) {
    if (e.automation) continue;
    if (e.signal && !arriving.has(e.target)) arriving.set(e.target, e.signal);
    if (!leaving.has(e.source)) leaving.set(e.source, e.signal);
  }
  const NONE: ReadonlySet<string> = new Set();
  for (const n of nodes.values()) {
    if (n.kind === "curve") continue; // a curve is a source of automation, not of signal
    n.jacks = {
      // A track has no input jack: what arrives on a lane is its clips, and there is no socket
      // for a reader to look for. A sink is the mirror image — somewhere to arrive, nowhere to leave.
      in:
        n.kind === "track"
          ? []
          : jacksFor(n.inputs, fed.get(n.id) ?? NONE, arriving.get(n.id), true),
      out:
        n.kind === "sink"
          ? []
          : jacksFor(
              n.outputs,
              left.get(n.id) ?? NONE,
              leaving.get(n.id),
              false,
            ),
    };
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

/** The gap between two strips in a mixer row, px. Wider than dagre's `nodesep` on purpose: these
 *  cards are read as a rank of separate channels, not as a chain that flows. */
const STRIP_GAP = 24;
const ROW_MARGIN = 16; // matches layout()'s marginx/marginy, so the two frame alike

/**
 * The named modules of a graph, laid out SIDE BY SIDE in the order given.
 *
 * What a mixer is: a rank of channel strips. dagre is deliberately not used — there are no cables
 * between these cards to route, and the ORDER is the caller's (the song's track order), which is
 * not a thing a layout engine should be allowed to choose. Nodes come from `buildGraph`, so each
 * card is the same card the full graph draws, live values and all; only its position is ours.
 *
 * A name with no module in the graph is skipped rather than drawn as a gap: the caller's list is
 * derived from the compiled project and the graph is refetched separately, so the two can be one
 * reload apart, and a hole in the row would be the only sign.
 *
 * The cards come WITHOUT their sockets — see the `jacks` line below.
 */
export function moduleRow(
  graph: WebGraph,
  modules: string[],
  /** Widen each card by this much. The GRID inside it is a fixed cell size and stays where it is,
   *  so this is elbow room around the controls rather than bigger controls — the Mixer asks for
   *  1.5, where strips are read side by side and a tight card reads as cramped. */
  widthScale = 1,
): LaidOutGraph {
  const { nodes } = buildGraph(graph);
  const byModule = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes)
    if (n.kind === "module" && n.module && !byModule.has(n.module))
      byModule.set(n.module, n);

  const out: GraphNode[] = [];
  let x = ROW_MARGIN;
  for (const name of modules) {
    const n = byModule.get(name);
    if (!n) continue;
    const w = Math.round(n.w * widthScale);
    // No sockets: this row has no edges, so every jack on it would lead nowhere. A plug that
    // plugs into nothing is furniture, and on a rank of strips it is furniture between them.
    out.push({ ...n, w, x, y: ROW_MARGIN, jacks: undefined });
    x += w + STRIP_GAP;
  }
  const tallest = out.reduce((h, n) => Math.max(h, n.h), 0);
  return {
    nodes: out,
    edges: [],
    width: out.length ? x - STRIP_GAP + ROW_MARGIN : 0,
    height: out.length ? tallest + ROW_MARGIN * 2 : 0,
  };
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
    // Carried through, and it was not: `targetPort` was set on the raw edge and then dropped
    // here, so the jack a cable names never reached the renderer at all. Every ported cable
    // landed on the node's edge like an unported one — the drawing said the port was a detail.
    targetPort: e.targetPort,
    sourcePort: e.sourcePort, // the mirror, and it drops the same way if forgotten here
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
