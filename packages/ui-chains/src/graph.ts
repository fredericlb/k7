// graph.ts — the Chains routing graph: model -> nodes/edges -> laid-out geometry.
// Renderer-agnostic on purpose, since dagre computes numbers and draws nothing: what
// comes out is plain geometry any renderer can consume. That split is what let the
// drawing move off Pixi/WebGL to the DOM without touching how the path is derived.

import dagre from "@dagrejs/dagre";
import type {
  WebChainStep,
  WebCurve,
  WebGraph,
  WebModuleUI,
  WebRackSound,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import { splitPort, TRACK_OUTPUTS } from "@studio/graph-model";
// Type-only the other way (hang.ts takes `Pt` as a type), so this import cannot cycle.
import { hangPoints } from "./hang";

/** What a node carries from its step, declared once instead of copied — see docs/graphBuild.md. */
const CARRIED = [
  "category",
  "inputs",
  "outputs",
  "assets",
  "assetChoices",
  "ui",
  "cc",
  "params",
  "pluginId",
  "monitor",
  // Which socket a live input is on: `inputUI` draws it and the renderer reads it back.
  "channel",
  "tap",
  // The module's other attribute sets, and which is on — see packages/song/docs/alternatives.md.
  "alternatives",
  "alternative",
  // A rack's loaded sounds: `rackUI` draws the pads and the renderer reads the row back.
  "rack",
  // What the module ANNOUNCES — its note-on, drawn as one socket per name.
  "events",
  // Which named base this module is on: the LIST becomes the dropdown, this says which entry is on.
  "base",
  // …and which SHADER a shader node runs, carried for the same reason `base` is.
  "shader",
  // The module this node is a USE of — the header draws it as the card's name.
  "uses",
] as const satisfies readonly (keyof WebChainStep)[];

/** …and the optional flags, which the node wants definite rather than `undefined`. */
const FLAGS = [
  "missing",
  "stub",
  "notSupported",
  "unknownPlugin",
  "hasNativePluginUI",
] as const satisfies readonly (keyof WebChainStep)[];

/** Read by buildGraph itself and deliberately absent from the node — see docs/graphBuild.md. */
type Consumed =
  | "module"
  | "enabled"
  | "emits"
  | "automations"
  // The base CHOICES become the dropdown's options in `stepUI` and are not wanted again.
  | "bases"
  // …and the shader choices, consumed exactly the same way by the same function.
  | "shaders";

type Carried = Pick<WebChainStep, (typeof CARRIED)[number]>;
type Flags = { [K in (typeof FLAGS)[number]]: boolean };

// The guard. `never` here means every field of WebChainStep is accounted for above.
type _Unplaced = Exclude<
  keyof WebChainStep,
  (typeof CARRIED)[number] | (typeof FLAGS)[number] | Consumed
>;
const _allPlaced: [_Unplaced] extends [never] ? true : never = true;
void _allPlaced;

/** One step's contribution to its node. */
function carryStep(s: WebChainStep): Carried & Flags {
  const out: Record<string, unknown> = {};
  for (const k of CARRIED) out[k] = s[k];
  for (const k of FLAGS) out[k] = !!s[k];
  return out as Carried & Flags;
}

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

export type Kind = "track" | "module" | "chain" | "sink" | "curve";

/** A node as the renderer receives it: its step's fields (DERIVED, see CARRIED/FLAGS) plus geometry. */
export interface GraphNode extends Carried, Flags {
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
  module?: string; // the module node name (for the nativePluginUI open)
  bypassed?: boolean; // the chain step is `enabled: false` — passes its input through
  /** BAKED into a render — not `dim`, which is one click from audible. See packages/song/docs/freeze.md. */
  frozen?: "at" | "inside";
  // A node that does not exist yet: the module being created, drawn where it will land.
  pending?: boolean;
  /** The sockets to DRAW, already decided — see `jacksFor` and docs/graphBuild.md. */
  jacks?: { in: Jack[]; out: Jack[] };
  /* `events` is CARRIED from the step and drawn apart from `jacks.out` — see docs/graphBuild.md. */

  /** This node LISTENS for events: one socket on its left edge, above the signal ones. */
  eventIn?: boolean;
  /** A curve node's BINDING, carried rather than parsed back out of the id — see docs/graphBuild.md. */
  curveOf?: { curve: string; module?: string; param?: string };
  /** This node sits in a row read ACROSS, so its cables meet the side edges — `moduleRow`'s doing. */
  flow?: "across";
  /** This node is a NOTE, and this is its text — a doc module's `content`, which `noteSize` measures. */
  note?: string;
  /** EVERY clip on the lane, not just the `CLIP_LIST_MAX` the list shows — see docs/graphBuild.md. */
  clips?: {
    ref: string;
    start: number;
    /** The position as the song spells it (`5:1:1`) — drawn to the left of the name. */
    tc: string;
    /** Where it sits on the mini timeline, 0..1, against the scale every lane shares. */
    at: number;
    /** How WIDE it is on that timeline, 0..1 — floored, so it is never 0. */
    w: number;
    kind: "audio" | "midi" | "missing";
  }[];
  /** How many clips did not fit in the LIST. Absent when it shows them all. */
  clipsMore?: number;
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

/** One socket on a node's edge. `name` is absent for the single port every module has. */
export interface Jack {
  name?: string;
  type: WebSignal;
  /** Nothing is wired to it. Drawn hollow: an invitation, not a connection. */
  free: boolean;
}

/** The sockets a node shows: inputs reveal themselves, outputs show at once — see docs/graphBuild.md. */
export function jacksFor(
  ports: { name: string; type: WebSignal; mandatory?: boolean }[] | undefined,
  fed: ReadonlySet<string>,
  fallback: WebSignal | undefined,
  grow: boolean,
  spare = false,
  /** Which declared port a cable that NAMES none counts against — the first, except off a lane. */
  bareOn?: string,
): Jack[] {
  // A module that declares nothing has the one port every module has, typed by what it handles.
  if (!ports?.length) {
    const type = fallback ?? "audio";
    // Both jacks are the SAME socket, so the spare writes a second arrow out of it — a send.
    if (spare && fed.size)
      return [
        { type, free: false },
        { type, free: true },
      ];
    return [{ type, free: !fed.size }];
  }
  // A cable that named no port lands on `bareOn` when the caller says which, else on the first.
  const takesBare = (p: { name: string }, i: number) =>
    bareOn ? p.name === bareOn : i === 0;
  const isFed = (p: { name: string }, i: number) =>
    fed.has(p.name) || (takesBare(p, i) && fed.has(""));
  // Outputs show all at once, their occupancy read per socket off the edge's `sourcePort`.
  if (!grow)
    return ports.flatMap((p, i) => {
      const jack = { name: p.name, type: p.type, free: !isFed(p, i) };
      if (!spare || jack.free) return [jack];
      // The spare twin carries the SAME ADDRESS as the cable already on it — see docs/graphBuild.md.
      const bare = takesBare(p, i) && fed.has("");
      return [
        jack,
        { ...(bare ? {} : { name: p.name }), type: p.type, free: true },
      ];
    });
  const mandatory = ports.filter((p) => p.mandatory !== false).length;
  // One past the LAST occupied port, not one past the count, or a module fed only on `b` loses `a`.
  let lastFed = -1;
  ports.forEach((p, i) => {
    if (isFed(p, i)) lastFed = i;
  });
  const shown = Math.min(ports.length, Math.max(1, mandatory, lastFed + 2));
  return ports
    .slice(0, shown)
    .map((p, i) => ({ name: p.name, type: p.type, free: !isFed(p, i) }));
}

// An automation edge's payload: a curve feeding a module's param. Undefined on a signal edge.
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
  // What this cable carries, decided by its SOURCE. Undefined ⇒ audio.
  signal?: WebSignal;
  /** Which INPUT of the target it lands on (`crossfade#b`); undefined ⇒ the first. See @studio/song's docs/ports.md. */
  targetPort?: string;
  /** …and which OUTPUT it left from (`sep#vocals: [ reverb ]`); undefined ⇒ the first. */
  sourcePort?: string;
  points: Pt[]; // dagre's routed polyline, absolute graph coords
}

/** An EVENT socket's centre — its own function because it spreads down the SIDE edges, not the flow's. */
export function eventPoint(
  n: GraphNode,
  side: "in" | "out",
  index: number,
): Pt {
  const count = Math.max(1, side === "out" ? (n.events?.length ?? 1) : 1);
  const i = Math.min(Math.max(0, index), count - 1);
  return {
    x: side === "in" ? n.x - PORT_PLATE / 2 : n.x + n.w + PORT_PLATE / 2,
    y: n.y + (n.h * (i + 1)) / (count + 1),
  };
}

/** A socket's centre in graph space, spread evenly down the node's edge as the plate's CSS is. */
export function jackPoint(n: GraphNode, side: "in" | "out", index: number): Pt {
  const count = Math.max(1, (n.jacks?.[side] ?? []).length);
  const i = Math.min(Math.max(0, index), count - 1);
  // A row read ACROSS meets its cables on the sides: out of the right edge, into the left.
  if (n.flow === "across")
    return {
      x: side === "in" ? n.x - PORT_PLATE / 2 : n.x + n.w + PORT_PLATE / 2,
      y: n.y + (n.h * (i + 1)) / (count + 1),
    };
  // Otherwise signal runs down: inputs on the TOP edge, outputs on the bottom, spread across the width.
  return {
    x: n.x + (n.w * (i + 1)) / (count + 1),
    y: side === "in" ? n.y - PORT_PLATE / 2 : n.y + n.h + PORT_PLATE / 2,
  };
}

/** A cable's polyline: it HANGS socket to socket, dagre's waypoints dropped — docs/hang.md, docs/graphBuild.md. */
export function cablePath(
  e: GraphEdge,
  src: GraphNode | undefined,
  tgt: GraphNode | undefined,
): Pt[] {
  const pts = e.points;
  if (pts.length < 2) return pts;
  // An EVENT cable meets the side edges, and its two ends are indexed differently — its own branch.
  if (e.signal === "event" && src && tgt) {
    const i = Math.max(0, src.events?.indexOf(e.sourcePort ?? "") ?? 0);
    return hangPoints(
      eventPoint(src, "out", i),
      eventPoint(tgt, "in", 0),
      true, // always sideways: both ends are on a left or right edge
    );
  }
  // A bare cable leaves the FIRST jack, except off a lane where it leaves the first OCCUPIED one.
  const fromIndex = e.sourcePort
    ? (src?.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? -1)
    : src?.kind === "track"
      ? (src.jacks?.out.findIndex((j) => !j.free) ?? -1)
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
  return hangPoints(from, to, src?.flow === "across" || tgt?.flow === "across");
}

export interface LaidOutGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number; // graph extent, for framing the camera
  height: number;
  /** Where the drawing STARTS when a PIN puts it above the origin. Both ≤ 0. See docs/graphBuild.md. */
  left: number;
  top: number;
}

// The arrow → `add_to_chain` mapping when a module can be dropped on it; null on an arrow with no `use` list.
export interface EdgeInsert {
  before: string;
  after: string;
}

// A track's live mixer state (volume in dB, pan 0..1, flags 0/1), on its own channel.
export interface TrackControlValues {
  volume: number;
  pan: number;
  mute: number;
  solo: number;
  arm: number;
}

// A node with no UI is this big; one with a UI is sized by its grid. Header + content always.

/** The main output, as a chain's `out.to` spells it — a bare name, taken literally everywhere. */
export const MAIN_OUT = "OUT";

/** The mixer's SUM — the one destination the graph draws no cable INTO. See docs/graphBuild.md. */
export const MIX_OUT = "MIX";

/** The PICTURE's two, drawn by exactly the rules above — see @studio/song's docs/videoOutputs.md. */
export const RENDER_OUT = "RENDER";
export const VIDEO_OUT = "VIDEO_OUT";

export const NODE_W = 160;
export const NODE_H = 70;

// The narrowest a card may be whatever its grid says — what the header strip needs. See docs/graphBuild.md.
export const NODE_MIN_W = 72;

// A port's plate, here rather than in the stylesheet so the cable's end and the CSS are one number.
export const PORT_PLATE = 13;

// Module-UI grid geometry in graph units, shared with the renderer. See docs/graphBuild.md.
export const CELL = 36;
export const UI_PAD = 6;
export const UI_HEADER = 38;

/** The font size a node's header name needs to be READ WHOLE, in px — see docs/graphBuild.md. */
export const HEADER_MAX_PX = 12.5; // .dgx-nm's size today, and the ceiling
export const HEADER_MIN_PX = 7.5;
const GLYPH_W = 0.55; // average advance per px of font size, for the header's face

/** What a module ref is CALLED — the last segment, the whole ref staying as the header's `title`. */
export function moduleDisplayName(ref: string): string {
  const cut = ref.lastIndexOf("/");
  const name = cut >= 0 ? ref.slice(cut + 1) : ref;
  return name || ref;
}

export function headerFontPx(label: string, availableW: number): number {
  const n = Math.max(1, label.length);
  const byWidth = availableW / (n * GLYPH_W);
  return Math.max(HEADER_MIN_PX, Math.min(HEADER_MAX_PX, byWidth));
}

// --- notes (doc modules) ---------------------------------------------------------

/** A note's text metrics: monospace-ish, and the box it needs. See @studio/song's docs/docModules.md. */
const NOTE_CHAR_W = 6.6; // one glyph at the size the renderer draws a note
const NOTE_LINE_H = 17;
const NOTE_PAD = 10;
const NOTE_MIN_W = 140;
const NOTE_MAX_W = 320; // past this a note is a document, and it wraps instead of widening

/** How big a NOTE has to be to show its text — dagre is told this. See docs/graphBuild.md. */
export function noteSize(text: string): { w: number; h: number } {
  const lines = (text || "").split("\n");
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = Math.max(
    NOTE_MIN_W,
    Math.min(NOTE_MAX_W, widest * NOTE_CHAR_W + NOTE_PAD * 2),
  );
  const perLine = Math.max(1, Math.floor((w - NOTE_PAD * 2) / NOTE_CHAR_W));
  // Every authored line takes at least one drawn line, and a long one takes as many as it wraps to.
  const drawn = lines.reduce(
    (n, l) => n + Math.max(1, Math.ceil(l.length / perLine)),
    0,
  );
  return { w, h: Math.max(NODE_H, drawn * NOTE_LINE_H + NOTE_PAD * 2) };
}

// --- a track's clip list (see docs/graphBuild.md) --------------------------------

/** How many clips a track node lists before it starts counting the rest instead. */
export const CLIP_LIST_MAX = 6;
/** One row, separator included — 15px of line plus the 1px rule (`.dgx-clip`). Tracks DomChains' CSS. */
const CLIP_ROW_H = 16;
/** The list's bottom padding, plus the rule that separates it from the controls above. */
const CLIP_LIST_PAD = 7;
/** The mini timeline above the list: its track, plus the gap under it (`.dgx-clip-tl`). */
const CLIP_TIMELINE_H = 14;
/** The narrowest a clip block is drawn, as a fraction of the timeline — ~3px on a 160px node. */
const CLIP_MIN_W = 0.02;

/** The clip list of a TRACK node, and the extra height it ADDS to its grid's. See docs/graphBuild.md. */
function clipsOf(
  graph: WebGraph,
  track: string,
  base: { w: number; h: number },
  /** The last position anything in the GRAPH sits at — the shared scale. See `clips.at`. */
  span: number,
): Partial<GraphNode> {
  const all = graph.trackClips?.[track];
  if (!all?.length) return {};
  const clips = all.map((c) => {
    // A graph whose clips all sit at bar 1 has no span to divide by, and 0 is where they belong.
    const at = span > 0 ? Math.min(1, Math.max(0, c.start / span)) : 0;
    const w =
      span > 0 && c.len ? Math.max(CLIP_MIN_W, c.len / span) : CLIP_MIN_W;
    // Clamped to the right edge, so a clip running past the last START stops at it.
    return { ...c, at, w: Math.min(w, 1 - at) || CLIP_MIN_W };
  });
  const more = Math.max(0, all.length - CLIP_LIST_MAX);
  // The rows the LIST will draw, plus the overflow line when there is one.
  const rows = Math.min(all.length, CLIP_LIST_MAX) + (more > 0 ? 1 : 0);
  return {
    clips,
    ...(more > 0 ? { clipsMore: more } : {}),
    w: base.w,
    h: base.h + CLIP_LIST_PAD + CLIP_TIMELINE_H + rows * CLIP_ROW_H,
  };
}

/** The scale every mini timeline shares: the last position in the GRAPH. See docs/graphBuild.md. */
function clipSpanOf(graph: WebGraph): number {
  let span = 0;
  // The END of the last clip, not its start, or the final block hangs off the right of every node.
  for (const clips of Object.values(graph.trackClips ?? {}))
    for (const c of clips) span = Math.max(span, c.start + (c.len ?? 0));
  return span;
}

/** The note bits of a module node, or nothing — `graph.modules` is keyed by DOC modules alone. */
function noteOf(
  g: WebGraph,
  module: string,
): { note: string; w: number; h: number } | Record<string, never> {
  const meta = g.modules?.[module];
  if (!meta || meta.content === undefined) return {};
  const text = meta.content;
  return { note: text, ...noteSize(text) };
}

// How big a node must be to hold `ui`; falls back to the plain size when there is no panel.
export function nodeSize(ui?: WebModuleUI): { w: number; h: number } {
  if (!ui?.cols || !ui?.rows) return { w: NODE_W, h: NODE_H };
  return {
    // The grid's width, NOT max(NODE_W, …) — see docs/graphBuild.md.
    w: Math.max(NODE_MIN_W, UI_PAD * 2 + ui.cols * CELL),
    h: Math.max(NODE_H, UI_HEADER + UI_PAD * 2 + ui.rows * CELL),
  };
}

// The built-in UI every TRACK node carries — five mixer controls on `@` binds. See docs/graphBuild.md.
export const TRACK_UI: WebModuleUI = {
  cols: 3,
  rows: 2,
  widgets: {
    // The three latching buttons share the top row, with the knobs beneath.
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

/** …and the MAIN OUTPUT's: the song's output level on an ORDINARY bind. See @studio/song's docs/masterVolume.md. */
export const MAIN_OUT_UI: WebModuleUI = {
  cols: 1,
  rows: 2,
  widgets: {
    vol: {
      type: "fader",
      col: 0,
      row: 0,
      rowSpan: 2,
      bind: "Volume",
      label: "out",
      min: -60,
      max: 12,
      step: 0.5,
    },
  },
};

/** The bind prefix a rack pad carries: `@rack:BD` fires the sound `BD`. See `rackUI`. */
export const RACK_BIND = "@rack:";

/** The symbol a rack-pad bind names, or null for any other bind. */
export const rackBindSymbol = (bind: string | undefined): string | null =>
  bind?.startsWith(RACK_BIND) ? bind.slice(RACK_BIND.length) : null;

/** The widest a pad grid gets — four, the shape a drum grid already has. */
const RACK_COLS = 4;
/** …and the smallest, so a one-sound rack still reads as a rack. See docs/graphBuild.md. */
const RACK_MIN = 2;

/** The shape a pad grid takes for `n` sounds: square-ish, never under 2×2, never over four wide. */
export function rackGrid(n: number): { cols: number; rows: number } {
  const cols = Math.max(
    RACK_MIN,
    Math.min(RACK_COLS, Math.ceil(Math.sqrt(Math.max(1, n)))),
  );
  return { cols, rows: Math.max(RACK_MIN, Math.ceil(Math.max(1, n) / cols)) };
}

/** The UI a RACK node carries: one `@rack:<symbol>` pad per loaded sound. See docs/graphBuild.md. */
export function rackUI(rack: readonly WebRackSound[]): WebModuleUI {
  const { cols, rows } = rackGrid(rack.length);
  const widgets: Record<string, WebWidget> = {};
  rack.forEach((s, i) => {
    widgets[`rack:${s.symbol}`] = {
      type: "button",
      col: i % cols,
      row: Math.floor(i / cols),
      bind: `${RACK_BIND}${s.symbol}`,
      label: s.symbol,
    };
  });
  return { cols, rows, widgets };
}

/** The UI a live INPUT node carries: its socket, its width, its monitoring. See docs/graphBuild.md. */
export function inputUI(
  devices: readonly { name: string; channels: number[] }[],
  channel: readonly number[] | undefined,
): WebModuleUI {
  const stereo = channel?.length === 2;
  const first = channel?.[0] ?? 1;
  // The socket list offers the CURRENT width; the other width is the question the control beside it asks.
  const sets = devices.filter((d) => d.channels.length === (stereo ? 2 : 1));
  // Width writes `channel:` too, and a pair is even/odd — the interface groups no other way.
  const odd = first % 2 === 1 ? first : first - 1;
  const widgets: Record<string, WebWidget> = {
    // `value` is a position in the list and nothing more: the channels travel in `arg`.
    channel: {
      type: "dropdown",
      col: 0,
      row: 0,
      colSpan: 2,
      bind: "@channel",
      label: "in",
      options: sets.map((d, i) => ({
        label: d.name,
        value: i,
        arg: d.channels.join(","),
      })),
    },
    width: {
      type: "dropdown",
      col: 0,
      row: 1,
      bind: "@channel",
      label: "width",
      options: [
        { label: "mono", value: 0, arg: String(first) },
        { label: "stereo", value: 1, arg: `${odd},${odd + 1}` },
      ],
    },
    monitor: {
      type: "dropdown",
      col: 1,
      row: 1,
      bind: "@monitor",
      label: "mon",
      options: [
        { label: "off", value: 0 },
        { label: "auto", value: 1 },
        { label: "on", value: 2 },
      ],
    },
  };
  return { cols: 2, rows: 2, widgets };
}

/** Fill in a folder-backed dropdown's options — `none` first, then the names. See docs/graphBuild.md. */
function withFolderOptions(
  ui: WebModuleUI,
  bind: string,
  names: readonly string[] | undefined,
): WebModuleUI {
  const binds = Object.values(ui.widgets ?? {}).some((w) => w.bind === bind);
  if (!binds) return ui;
  const options = [
    { label: "none", value: 0 },
    ...(names ?? []).map((b, i) => ({ label: b, value: i + 1 })),
  ];
  const widgets: Record<string, WebWidget> = {};
  for (const [id, w] of Object.entries(ui.widgets ?? {}))
    widgets[id] = w.bind === bind ? { ...w, options } : w;
  return { ...ui, widgets };
}

/** The binds a folder-backed dropdown carries — each intrinsic's name, verbatim, as every bind is. */
const BASE_BIND = "@base";
/** …and the shader's, the same mechanism over a different folder. See @studio/song's docs/shaders.md. */
const SHADER_BIND = "@shader";

/** The panel a step actually draws — one function, so the node's SIZE and its `ui` cannot disagree. */
function stepUI(
  s: WebChainStep,
  devices: readonly { name: string; channels: number[] }[] | undefined,
): WebModuleUI | undefined {
  // The folder lists fold into whichever panel is drawn, authored or synthesised, and in one place.
  if (s.ui)
    return withFolderOptions(
      withFolderOptions(s.ui, BASE_BIND, s.bases),
      SHADER_BIND,
      s.shaders,
    );
  if (s.rack?.length) return rackUI(s.rack);
  return s.monitor !== undefined
    ? inputUI(devices ?? [], s.channel)
    : undefined;
}

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

// A widget's range, defaulting to 0..1 — right for a normalised plugin param, wrong for native units.
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
  // `step` quantises what the user can reach, not what they see.
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

// The node-local centre of the widget bound to `param` — where an automation arrow lands.
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

// A curve node's secondary line: the kind, plus the LFO shape. ASCII only — the BitmapText atlas.
function curveSubLabel(curve: WebCurve): string {
  if (curve.type === "lfo") return `lfo ${curve.shape ?? "sine"}`;
  // An envelope says so rather than borrowing "custom": it is the one curve with an event socket.
  return curve.type === "adsr" ? "adsr" : "custom";
}

// Build nodes and unpositioned edges from the chain graph, mirroring the signal path. See docs/graphBuild.md.
export function buildGraph(
  graph: WebGraph,
  opts: {
    /** Draw a card for the DEVICES the signal leaves by, `VIDEO_OUT` included. The DEFAULT. See docs/graphBuild.md. */
    drawMainOut?: boolean;
    /** The song's output level in dB — a project setting, so not in the graph document. Absent ⇒ unknown. */
    mainOutVolume?: number;
    /** How the machine's interface groups its inputs — the sound card's to say, not the document's. */
    inputDevices?: readonly { name: string; channels: number[] }[];
  } = {},
): {
  nodes: RawNode[];
  edges: RawEdge[];
} {
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>(); // keyed by "source->target" so a connection is drawn once
  // Which curves a binding put on the graph, so the ones nothing binds can be drawn beside them.
  const boundCurves = new Set<string>();

  const isChain = (n: string) => n in graph.chains;
  const isTrack = (n: string) => graph.tracks.includes(n);
  const isVideoTrack = (n: string) => !!graph.videoTracks?.includes(n);
  const trackId = (n: string) => `trk:${n}`;
  const sinkId = (n: string) => `snk:${n}`;
  // The sum's card — a SINK like `OUT`, whatever the run headed by it is written as.
  const mixId = sinkId(MIX_OUT);
  // …and the picture's, which is the same card in every respect the drawing cares about.
  const renderId = sinkId(RENDER_OUT);
  // Is this name one of the two SUMS? Every test below that singles one out means both.
  const isSum = (n: string) => n === MIX_OUT || n === RENDER_OUT;
  // …and the other end: the two DEVICES the signal leaves by, which `drawMainOut` governs together.
  const isDevice = (n: string) => n === MAIN_OUT || n === VIDEO_OUT;
  const moduleId = (mod: string) => `mod:${mod}`;
  const chainId = (chain: string) => `chn:${chain}`;
  // A chain's two ends. A MASTER run holding no module ends on the sum's own card — docs/graphBuild.md.
  const endId = (chain: string, module: string | undefined) =>
    module !== undefined
      ? moduleId(module)
      : chain === MIX_OUT
        ? mixId
        : chain === RENDER_OUT
          ? renderId
          : chainId(chain);
  const entryId = (chain: string) => {
    const u = graph.chains[chain].use;
    return endId(chain, u[0]?.module);
  };
  const exitId = (chain: string) => {
    const u = graph.chains[chain].use;
    return endId(chain, u[u.length - 1]?.module);
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
      // The sub line names the chains sharing this module, so it must follow the MERGE.
      existing.sub = merged.size > 1 ? [...merged].join(", ") : undefined;
    }
    return id;
  };
  /** A destination with no module behind it — a built-in output, or a name the graph cannot account for. */
  const addSink = (name: string, extra: Partial<Omit<RawNode, "id">> = {}) =>
    add(sinkId(name), {
      label: name,
      kind: "sink",
      dim: false,
      missing: false,
      stub: false,
      notSupported: false,
      unknownPlugin: false,
      hasNativePluginUI: false,
      ...extra,
    });
  /** …and what the MAIN OUTPUT's card carries beyond that: its own fader, absent rather than 0. */
  const mainOutCard = (): Partial<Omit<RawNode, "id">> => ({
    module: MAIN_OUT,
    ui: MAIN_OUT_UI,
    ...(opts.mainOutVolume === undefined
      ? {}
      : { params: { Volume: opts.mainOutVolume } }),
    ...nodeSize(MAIN_OUT_UI),
  });
  // The maximum step index a module holds across chains, so a shared one ranks after every pipeline.
  const moduleRank = new Map<string, number>();

  // The FROZEN pass was here; freezing is gone with the field it read (packages/song/docs/trackModules.md).

  // Once for the whole graph, so every lane's mini timeline is drawn against the same ruler.
  const clipSpan = clipSpanOf(graph);
  /** Add a connection once — but "once" is per SOCKET, not per pair. See docs/graphBuild.md. */
  const pairs = new Map<string, string[]>(); // "a->b" (unordered) -> edge ids on it
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const link = (
    source: string,
    target: string,
    label?: string,
    signal?: WebSignal,
    targetPort?: string,
    sourcePort?: string,
  ) => {
    if (source === target) return; // a chain that feeds itself — skip the degenerate self-loop
    const pk = pairKey(source, target);
    const onPair = pairs.get(pk) ?? [];
    // A cable already here that this expression could BE: same source port, or either naming none.
    const existing = onPair
      .map((id) => edges.get(id))
      .find(
        (e) =>
          e !== undefined &&
          (!sourcePort || !e.sourcePort || e.sourcePort === sourcePort),
      );
    if (existing) {
      if (!existing.label && label) existing.label = label;
      if (!existing.signal && signal) existing.signal = signal;
      if (!existing.targetPort && targetPort) existing.targetPort = targetPort;
      if (!existing.sourcePort && sourcePort) existing.sourcePort = sourcePort;
      return;
    }
    // The port is IN the id: two cables between one pair need two, and the renderer keys on it.
    const key = `${source}${sourcePort ? `#${sourcePort}` : ""}->${target}`;
    pairs.set(pk, [...onPair, key]);
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

  // Every module that appears as a step somewhere — normally what a side input's target is.
  const usedModules = new Set<string>();
  for (const c of Object.values(graph.chains))
    for (const s of c.use) usedModules.add(s.module);

  // Did anything route to a sum? One flag per sum, used when the file declares no master run.
  const feedsSum = { [MIX_OUT]: false, [RENDER_OUT]: false };

  // What leaves a chain — its last module, or whatever reached a pass-through. `seen` guards the follow.
  const exitSignal = (
    chain: string,
    seen = new Set<string>(),
  ): WebSignal | undefined => {
    const c = graph.chains[chain];
    if (!c || seen.has(chain)) return undefined;
    seen.add(chain);
    if (c.use.length) return c.use[c.use.length - 1].emits;
    if (!c.from) return undefined;
    // A run out of a SUM is answered BY NAME — following `from` re-enters this chain. docs/graphBuild.md.
    if (isSum(c.from)) return c.from === RENDER_OUT ? "video" : "audio";
    // A run that left a lane by a named output carries that output's signal, whatever the lane holds.
    if (c.fromPort === "midi" || c.fromPort === "audio") return c.fromPort;
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
      // Read once: the node's panel and the node's size are the same answer.
      const ui = stepUI(s, opts.inputDevices);
      add(mid, {
        label: s.module,
        // Only the SHARED case earns a sub line: editing this module reaches more than one chain. See docs/graphBuild.md.
        sub: chains.length > 1 ? chains.join(", ") : undefined,
        kind: "module",
        chain: chains[0],
        chains,
        dim: !chainOn || s.enabled === false,
        // Distinct from `dim`, which also covers a whole chain: this is THIS step's bypass.
        bypassed: s.enabled === false,
        module: s.module,
        // …and whether it is inside somebody's render — one map answers for a lane and a module alike.
        ...(graph.frozen?.[s.module] ? { frozen: graph.frozen[s.module] } : {}),
        // Everything the step itself says, in one move — see CARRIED/FLAGS.
        ...carryStep(s),
        // The panel the node actually DRAWS, over the raw one `carryStep` brought — docs/graphBuild.md.
        ui,
        ...nodeSize(ui), // as big as its grid needs
        // …and a NOTE is as big as its text, which overrides that: a note has no widget grid.
        ...noteOf(graph, s.module),
      });
      // Track the maximum position this module occupies across all chains.
      moduleRank.set(mid, Math.max(moduleRank.get(mid) ?? 0, i));
      if (i > 0) {
        const prev = c.use[i - 1];
        const prevId = moduleId(prev.module);
        // The cable between two modules carries what the UPSTREAM one emits.
        link(prevId, mid, undefined, prev.emits);
        // Within-chain series edges get a higher weight so dagre keeps them tight.
        const e = edges.get(`${prevId}->${mid}`);
        if (e) e.weight = (e.weight ?? 1) + 4;
      }

      // One curve node PER BINDING, the id carrying it — see docs/graphBuild.md.
      for (const a of s.automations ?? []) {
        const curve = graph.curves?.[a.curve];
        if (!curve) continue; // the curve was dropped (missing file) — nothing to draw
        boundCurves.add(a.curve);
        const cid = `crv:${a.curve}@${s.module}:${a.param}`;
        add(cid, {
          label: a.curve,
          sub: curveSubLabel(curve),
          kind: "curve",
          // Only an envelope has anything to be restarted BY, and the socket is what says so.
          eventIn: curve.type === "adsr",
          curveOf: { curve: a.curve, module: s.module, param: a.param },
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
        });
        // The node id already names the binding, so the edge key is just its two ends.
        const key = `${cid}->${moduleId(s.module)}`;
        edges.set(key, {
          id: key,
          source: cid,
          target: moduleId(s.module),
          automation: { param: a.param, widget: widgetCenter(s.ui, a.param) },
        });
        // …and, for an envelope, the cable that FIRES it — the same `trigger` field the compiler bakes.
        if (curve.type === "adsr") {
          const from = moduleId(a.trigger ?? s.module);
          const ek = `ev:${from}->${cid}`;
          edges.set(ek, {
            id: ek,
            source: from,
            target: cid,
            signal: "event",
            sourcePort: "note-on",
          });
        }
      }
    });
    // A pass-through card for a chain holding no module — except either MASTER run, whose ends are cards already.
    if (!c.use.length && !isSum(name))
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

    // A `from` is chain-feeds-chain only when it names a DIFFERENT chain and not a track. See docs/graphBuild.md.
    if (c.from) {
      // The MASTER run starts at a SUM, which is a built-in output and not a lane — docs/graphBuild.md.
      if (isSum(c.from))
        link(
          addSink(c.from),
          entryId(name),
          undefined,
          c.from === RENDER_OUT ? "video" : "audio",
        );
      else if (c.from !== name && isChain(c.from) && !isTrack(c.from))
        link(exitId(c.from), entryId(name), undefined, exitSignal(c.from));
      else {
        const video = isVideoTrack(c.from);
        const ui = video ? VIDEO_TRACK_UI : TRACK_UI;
        add(trackId(c.from), {
          label: c.from,
          kind: "track",
          video,
          // The two outputs a lane offers, audio first — a video lane keeps its single picture one.
          ...(video ? {} : { outputs: TRACK_OUTPUTS.map((o) => ({ ...o })) }),
          color: graph.trackColors?.[c.from],
          // A lane is a module node, so it is addressable like one — packages/song/docs/alternatives.md.
          module: c.from,
          ...(graph.trackAlternatives?.[c.from] ?? {}),
          ...(graph.frozen?.[c.from] ? { frozen: graph.frozen[c.from] } : {}),
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
          ui, // the mixer controls; values arrive via setTrackControls
          ...nodeSize(ui), // grow the node to fit its grid
          // …and again to fit what the lane HOLDS — see docs/graphBuild.md.
          ...clipsOf(graph, c.from, nodeSize(ui), clipSpan),
        });
        // What the cable carries AND which jack it leaves by: `fromPort` is both. See docs/graphBuild.md.
        const port = c.fromPort;
        link(
          trackId(c.from),
          entryId(name),
          undefined,
          video
            ? "video"
            : port === "midi"
              ? "midi"
              : port === "audio"
                ? "audio"
                : (graph.trackSignals?.[c.from] ?? "audio"),
          undefined,
          port,
        );
      }
    }

    // Outputs: this chain's exit → each target (another chain's entry, or a sink).
    for (const o of c.out) {
      // A destination may name a PORT (`crossfade#b`), split off before any test below or it invents a sink.
      const { node: toNode, port: toPort } = splitPort(o.to);
      // A cable into the SUM is not drawn — every chain in the song ends there. See docs/graphBuild.md.
      if (isSum(toNode)) {
        feedsSum[toNode] = true;
        continue;
      }
      // A host may ask for the DEVICES to be left out entirely — see `drawMainOut`.
      if (isDevice(toNode) && opts.drawMainOut === false) continue;
      // …and when OUT is drawn it carries its own fader; `VIDEO_OUT` has no param, so it draws bare.
      const mainOut = toNode === MAIN_OUT ? mainOutCard() : {};
      const to = isTrack(toNode)
        ? trackId(toNode)
        : isChain(toNode)
          ? entryId(toNode)
          : // A module that is a STEP inside someone else's chain — which is what a side input's
            // target usually is, since one flow feeder keeps it absorbed. It has a node already.
            usedModules.has(toNode)
            ? moduleId(toNode)
            : addSink(toNode, mainOut);
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

  /** Each sum and the wire out of it, when the file declares no master run. See docs/graphBuild.md. */
  for (const sum of [MIX_OUT, RENDER_OUT] as const) {
    if (!feedsSum[sum] || isChain(sum)) continue;
    const card = addSink(sum);
    if (opts.drawMainOut === false) continue;
    const video = sum === RENDER_OUT;
    link(
      card,
      video ? addSink(VIDEO_OUT) : addSink(MAIN_OUT, mainOutCard()),
      undefined,
      video ? "video" : "audio",
    );
  }

  // Tracks (and video lanes) no chain mentions, drawn as ORPHANS with `sub` carrying the reason. See docs/graphBuild.md.
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
      // Both outputs, exactly as a routed lane's: a lane offers them whether or not anything is plugged in.
      ...(video ? {} : { outputs: TRACK_OUTPUTS.map((o) => ({ ...o })) }),
      color: graph.trackColors?.[id],
      module: id,
      ...(graph.trackAlternatives?.[id] ?? {}),
      ...(graph.frozen?.[id] ? { frozen: graph.frozen[id] } : {}),
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

  // Which input ports have a cable, per node — a last pass, since it needs every edge. docs/graphBuild.md.
  const fed = new Map<string, Set<string>>();
  // …and the mirror, per OUTPUT port, so a splitter's wired and spare sockets are told apart.
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
  /** The curves nothing binds — one free card each, their ids carrying no binding. See docs/graphBuild.md. */
  for (const [id, curve] of Object.entries(graph.curves ?? {}))
    if (!boundCurves.has(id))
      add(`crv:${id}`, {
        label: id,
        sub: curveSubLabel(curve),
        kind: "curve",
        eventIn: curve.type === "adsr",
        // No module or param: this card is bound to nothing, which is what makes it free.
        curveOf: { curve: id },
        dim: false,
        missing: false,
        stub: false,
        notSupported: false,
        unknownPlugin: false,
        hasNativePluginUI: false,
      });

  // What LEAVES a node colours its output jack; an unfed input borrows the cable that reaches it.
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
    // A live INPUT is a SOURCE, and so is the SUM — see docs/graphBuild.md for both reasons.
    const source = n.monitor !== undefined || n.id === mixId;
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
          ),
      // A sink has nowhere to leave — except the SUM, where the MASTER RUN begins.
      out:
        n.kind === "sink" && n.id !== mixId
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
                ? (graph.trackSignals?.[n.label] ?? "audio")
                : undefined,
            ),
    };
  }

  // dagre rank hints: tracks 0, modules 1 + their max position, sinks past the deepest, pass-throughs 1.
  let maxModRank = 0;
  for (const r of moduleRank.values()) maxModRank = Math.max(maxModRank, r);
  for (const n of nodes.values()) {
    if (n.kind === "track") n.rank = 0;
    // Either SUM is drawn as a sink but ranked where a LANE is: the master run LEAVES it, downward.
    else if (n.id === mixId || n.id === renderId) n.rank = 0;
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
  } = {},
): LaidOutGraph {
  const { widthScale = 1, links = false } = opts;
  const { nodes, edges } = buildGraph(graph);
  const byModule = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes)
    if (n.kind === "module" && n.module && !byModule.has(n.module))
      byModule.set(n.module, n);

  const picked = modules
    .map((name) => byModule.get(name))
    .filter((n): n is (typeof nodes)[number] => !!n);
  // One height for the whole row, the tallest card's, so the camera fits every card and not just it.
  const tallest = picked.reduce((h, n) => Math.max(h, n.h), 0);

  const out: GraphNode[] = [];
  const inRow = new Set<string>();
  let x = ROW_MARGIN;
  for (const n of picked) {
    const w = Math.round(n.w * widthScale);
    inRow.add(n.id);
    out.push({
      ...n,
      w,
      h: tallest,
      x,
      y: ROW_MARGIN,
      // Sockets are never PLATED here: the plates are CSS-pinned to edges this row does not use.
      jacks: undefined,
      ...(links ? { flow: "across" as const } : {}),
    });
    x += w + STRIP_GAP;
  }
  return {
    nodes: out,
    edges: links
      ? edges
          .filter((e) => inRow.has(e.source) && inRow.has(e.target))
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
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          }))
      : [],
    width: out.length ? x - STRIP_GAP + ROW_MARGIN : 0,
    height: out.length ? tallest + ROW_MARGIN * 2 : 0,
    // A row lays itself out from `ROW_MARGIN` and ignores pins entirely: it begins at the origin.
    left: 0,
    top: 0,
  };
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
  for (const r of ranks) {
    const row = snapped
      .filter((n) => rankOf.get(n.id) === r)
      .sort((a, b) => a.x - b.x);
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

// Position with dagre. It returns centres; we store top-left, edge points staying in absolute graph space.
export function layout(
  nodes: RawNode[],
  raw: RawEdge[],
  // Where somebody PINNED nodes (chains.yaml `positions:`, by chains name) — see docs/graphBuild.md.
  positions?: Record<string, { x: number; y: number }>,
  // Where each node was DRAWN last time, by node id — the host's session memory, outranked by a pin.
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

  const placed: GraphNode[] = nodes.map((n) => {
    const { x, y } = g.node(n.id);
    // dagre returns a node's CENTRE; everything downstream wants its top-left.
    return { ...n, x: x - n.w / 2, y: y - n.h / 2 };
  });

  let outNodes = snapToRankRows(
    placed,
    new Map(
      nodes.flatMap((n) =>
        typeof n.rank === "number" ? [[n.id, n.rank] as const] : [],
      ),
    ),
  );
  if (positions || prev) {
    // `jackRef`'s name resolution, inlined because cables.ts imports this file. See docs/graphBuild.md.
    outNodes = outNodes.map((n) => {
      const p =
        positions?.[n.kind === "module" ? (n.module ?? n.label) : n.label] ??
        prev?.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
  }
  const outEdges: GraphEdge[] = raw.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    automation: e.automation,
    signal: e.signal,
    // Carried through, and it was not — see docs/graphBuild.md for what a dropped port drew.
    targetPort: e.targetPort,
    sourcePort: e.sourcePort, // the mirror, and it drops the same way if forgotten here
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
