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
import { splitPort } from "@studio/graph-model";
// Type-only the other way (hang.ts takes `Pt` as a type), so this import cannot cycle.
import { hangPoints } from "./hang";

/**
 * What a node carries from its step, and how — declared once instead of copied.
 *
 * `buildGraph` used to restate these field by field, which made "add a field" three edits in
 * three files. `assetChoices` missed the third: it reached the browser and stopped at the node,
 * so st0 re-fetched the whole graph on a click to read a value already under the mouse. The same
 * shape of omission put every ported cable on the node's edge once, when `targetPort` was
 * forgotten on the edge copy below.
 *
 * Three groups, and the guard underneath makes them cover the type: a new field on
 * `WebChainStep` stops the build HERE, by name, until it is placed in one of them.
 */
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
  // Which socket a live input is on. Carried rather than consumed for the same reason `rack` is:
  // `inputUI` below turns it into the node's dropdowns, and the renderer needs the numbers again to
  // know which entry is the current one.
  "channel",
  "tap",
  // The module's other attribute sets, and which is on. Carried rather than consumed: the node
  // draws a menu from them, and they arrive only when there is more than one to pick — so a node
  // with none grows no button. See packages/song/docs/alternatives.md.
  "alternatives",
  "alternative",
  // A rack's loaded sounds. Carried rather than consumed, because two things read it: `rackUI`
  // below turns it into the node's pads, and the renderer needs the row again to know what a
  // tapped pad should sound.
  "rack",
  // What the module ANNOUNCES — its note-on. Carried straight through: the node draws a socket
  // per name, and nothing here derives anything from it.
  "events",
  // Which named base this module is on. Carried rather than consumed, exactly like `channel`:
  // `withBaseOptions` turns the LIST into the dropdown's entries, and the renderer needs the
  // chosen name again to know which of those entries is the current one.
  "base",
] as const satisfies readonly (keyof WebChainStep)[];

/** …and the optional flags, which the node wants definite rather than `undefined`. */
const FLAGS = [
  "missing",
  "stub",
  "notSupported",
  "unknownPlugin",
  "hasNativePluginUI",
] as const satisfies readonly (keyof WebChainStep)[];

/** Read by buildGraph itself and deliberately absent from the node: `module` becomes the
 *  label and the id, `enabled` becomes `bypassed`/`dim`, `emits` decides an edge's signal,
 *  and `automations` become nodes of their own. */
type Consumed =
  | "module"
  | "enabled"
  | "emits"
  | "automations"
  // The base CHOICES become the dropdown's options in `stepUI` and are not wanted again: what
  // the renderer needs afterwards is `base`, which entry is on, and the options carry the rest.
  | "bases";

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

/**
 * The modules one track's signal reaches, in the order it reaches them.
 *
 * Chain by chain from the track's own, then step by step inside each — which is the order the
 * song is written in, and the only one that means anything to a reader. De-duplicated, because a
 * module shared between two of the track's chains is one module: drawing it twice would offer
 * two sets of controls for one thing.
 *
 * Off `subgraphForTrack`, so a send that leaves the track's own chain is included exactly as it
 * is when the graph frames a track. What this adds is the ORDER, which a node set does not carry.
 */
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

/**
 * A node as the renderer receives it: what its step carries, plus what only a laid-out graph
 * knows — identity, kind, and geometry.
 *
 * The step's own fields are DERIVED (see CARRIED/FLAGS) rather than restated, so they are
 * documented in one place, `WebChainStep`, and cannot fall out of step with it.
 */
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
  /**
   * BAKED into a render: `"at"` the point it was taken at, `"inside"` when the render already
   * contains this node. Not `dim` — a bypassed module is still built and is one click from
   * audible, while a frozen one does not exist for the engine at all until the point is thawed.
   * See packages/song/docs/freeze.md.
   */
  frozen?: "at" | "inside";
  // A node that does not exist yet: the module being created right now, drawn where it will land. It is not in
  // any graph the server has — the canvas inserts it on the click and drops it when real data arrives.
  pending?: boolean;
  /** The sockets to DRAW, already decided — see `jacksFor`. Computed here rather than in the
   *  renderer because how many a node shows depends on what is wired to it, which is a fact
   *  about the graph and not about the DOM. Not from the step: it depends on what is wired. */
  jacks?: { in: Jack[]; out: Jack[] };
  /* `events` — what this node announces — is CARRIED from the step; see CARRIED above. It is
     drawn as labelled sockets down the right edge, apart from `jacks.out`: those are the signal
     path, and an event is not something the chain carries. One list would let a cable be dragged
     from a note-on into an audio input — the drawing allowing what the model forbids. */
  /** This node LISTENS for events: one socket on its left edge, above the signal ones. A curve
   *  has it when it is an envelope — the only curve with anything to be restarted by. */
  eventIn?: boolean;
  /**
   * A curve node's BINDING: the curve's own id, and the module param it drives when it drives
   * one. Absent `module`/`param` ⇒ a free card, bound to nothing yet.
   *
   * Carried rather than parsed back out of the node id, which spells the same thing: a module
   * ref may itself contain a colon (`synth:lead`), so `crv:env1@synth:lead:Filter Freq` has no
   * unambiguous reading. The renderer needs all three to write `node automate`, and a gesture
   * that guessed them wrong would rewrite somebody else's binding.
   */
  curveOf?: { curve: string; module?: string; param?: string };
  /**
   * This node sits in a row read ACROSS, not in a column read down — `moduleRow`'s doing.
   *
   * All it changes is where a cable meets it: sockets on the left and right edges instead of the
   * top and bottom. It is on the node rather than on the graph because `cablePath` is handed two
   * nodes and no graph, and a cable's shape is a fact about its ends.
   */
  flow?: "across";
  /**
   * This node is a NOTE, and this is its text — a doc module's `content`, drawn as written.
   *
   * On the node rather than looked up by the renderer because a node already carries everything
   * needed to draw it, and because the SIZE below is computed from this text: dagre has to be
   * told how much room the prose needs before anything is drawn. See `noteSize`.
   */
  note?: string;
  /**
   * TRACK only: the clips this lane holds, in playing order — listed under its mixer controls.
   *
   * On the node for the same reason `note` is: the size below is computed from it, so dagre has
   * to be told how much room the list needs before anything is drawn. Trimmed to `CLIP_LIST_MAX`
   * with the overflow counted (`clipsMore`) rather than shown — a lane with sixty clips would
   * otherwise be a node taller than the window, and the graph is a picture of the ROUTING.
   */
  /**
   * EVERY clip on the lane, not just the listed ones.
   *
   * The mini timeline above the list draws all of them — it is a picture of the whole lane —
   * while the list below shows the first `CLIP_LIST_MAX`. The renderer slices; the node carries
   * the lot, because dropping a clip here would put a gap in the timeline instead of in a list
   * that already says how many it left out.
   */
  clips?: {
    ref: string;
    start: number;
    /** The position as the song spells it (`5:1:1`) — drawn to the left of the name. */
    tc: string;
    /**
     * Where it sits on the mini timeline, 0..1.
     *
     * Against a scale SHARED by every track in the graph, not this lane's own extent: two lanes
     * side by side have to be comparable, and a per-lane scale would draw a clip at bar 2 and
     * one at bar 200 in the same place while claiming to show where things are.
     */
    at: number;
    /**
     * How WIDE it is on that timeline, 0..1 — its duration against the same shared scale.
     *
     * A floor is applied so a very short clip in a long song is still a block you can see and
     * point at rather than a hairline: a mini timeline is for finding things, and a marker too
     * small to hit is one you cannot hover. Absent lengths (a project that will not compile)
     * fall back to that same floor, which is why this is never 0.
     */
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
 *
 * `spare` is for a node whose sockets are a LIST rather than a fixed set — a lane's outputs, which
 * are its sends. Its one undeclared socket taken, it grows a free one beside it, or a lane feeding
 * one thing could never feed a second. It says nothing about a node that DECLARES its ports: a
 * separator with three stems has three, and a fourth hole would be a lie about the module.
 */
export function jacksFor(
  ports: { name: string; type: WebSignal; mandatory?: boolean }[] | undefined,
  fed: ReadonlySet<string>,
  fallback: WebSignal | undefined,
  grow: boolean,
  spare = false,
): Jack[] {
  // A module that declares nothing has the one port every module has, typed by what it handles.
  if (!ports?.length) {
    const type = fallback ?? "audio";
    // Both jacks are the SAME socket — `jackRef` names an unnamed one by its node alone, so the
    // spare writes a second arrow out of it rather than addressing a second port. That is what a
    // send IS, and it is why the spare survives: the one below it never stops being fed.
    if (spare && fed.size)
      return [
        { type, free: false },
        { type, free: true },
      ];
    return [{ type, free: !fed.size }];
  }
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
/**
 * An EVENT socket's centre — the right edge for a module that announces one, the left for a
 * curve that listens.
 *
 * Its own function rather than a branch inside `jackPoint`, because it does not spread down the
 * same edge: signal runs top to bottom here, so the sides are free and an event never has to
 * share a rank with a flow socket. The renderer places its plates from the same fractions.
 */
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

export function jackPoint(n: GraphNode, side: "in" | "out", index: number): Pt {
  const count = Math.max(1, (n.jacks?.[side] ?? []).length);
  const i = Math.min(Math.max(0, index), count - 1);
  // A row read ACROSS meets its cables on the sides: out of the right edge, into the left. The
  // top and bottom would send a cable diving under the card and back up to its neighbour, for a
  // signal that is travelling sideways.
  if (n.flow === "across")
    return {
      x: side === "in" ? n.x - PORT_PLATE / 2 : n.x + n.w + PORT_PLATE / 2,
      y: n.y + (n.h * (i + 1)) / (count + 1),
    };
  // Otherwise signal runs down, so inputs sit on the TOP edge and outputs on the bottom, spread
  // across the card's width. It was the left and right edges while the layout ran left to right.
  return {
    x: n.x + (n.w * (i + 1)) / (count + 1),
    y: side === "in" ? n.y - PORT_PLATE / 2 : n.y + n.h + PORT_PLATE / 2,
  };
}

/**
 * A cable's polyline: it HANGS from the socket it leaves to the socket it plugs into.
 *
 * dagre's waypoints are deliberately dropped. They bent a cable around the card it skipped, which
 * is the right answer for a flow chart and the wrong one for a patch bay: a rack's cables run
 * plug to plug and cross where they cross — over the cards, which is why the canvas draws above
 * them. dagre still places the nodes; the cable is gravity's (`hangPoints`, docs/hang.md), a stub
 * out of each plate and then the sag, sampled so the Catmull-Rom every consumer already traces
 * through these points IS the curve. It was a straight line for a while; a straight line is a
 * cable with infinite tension, and nothing on a desk looks like that.
 *
 * The endpoints are the sockets rather than dagre's border points, which is what makes a cable
 * look plugged in. Both are the ones the cable NAMES — `crossfade#b` for the jack it arrives at,
 * `sep#vocals` for the one it leaves — each matched against that node's jack list. A name that
 * matches nothing falls back to the first jack rather than dropping the cable: an unroutable edge
 * is still an edge worth seeing.
 */
export function cablePath(
  e: GraphEdge,
  src: GraphNode | undefined,
  tgt: GraphNode | undefined,
): Pt[] {
  const pts = e.points;
  if (pts.length < 2) return pts;
  // An EVENT cable meets the side edges, not the top and bottom: it leaves a socket the module
  // announces and lands on the one the envelope listens with, and neither is on the signal path.
  // Its own branch rather than a widened jackPoint, since the two ends are indexed differently —
  // one per announced event on the way out, always the one on the way in.
  if (e.signal === "event" && src && tgt) {
    const i = Math.max(0, src.events?.indexOf(e.sourcePort ?? "") ?? 0);
    return hangPoints(
      eventPoint(src, "out", i),
      eventPoint(tgt, "in", 0),
      true, // always sideways: both ends are on a left or right edge
    );
  }
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
  return hangPoints(from, to, src?.flow === "across" || tgt?.flow === "across");
}

export interface LaidOutGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number; // graph extent, for framing the camera
  height: number;
  /**
   * Where the drawing STARTS, when that is not the origin. Both ≤ 0, and both 0 for a layout
   * dagre placed on its own — it lays out from `marginx`/`marginy` down and right.
   *
   * A PIN can sit anywhere, including above the first track or left of it, which is the point of
   * a pin. The extents above measure how far the picture reaches; these two say where it begins,
   * and a camera that frames `width × height` from 0 would cut off exactly the cards somebody
   * dragged up there. See docs/graphBuild.md.
   */
  left: number;
  top: number;
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
/**
 * The main output, as a chain's `out.to` spells it — and the ONE destination the graph does not
 * draw. See where it is skipped in `buildGraph`. Taken literally elsewhere too (`nodeProject`'s
 * isSink, `@studio/song`'s graph), which is why it is a bare name rather than a shape.
 */
export const MAIN_OUT = "OUT";

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

// Module-UI grid geometry in graph units, shared with the renderer so hit areas and drawing agree by construction.
// See docs/graphBuild.md for what UI_HEADER and CELL are sized against.
export const CELL = 36;
export const UI_PAD = 6;
export const UI_HEADER = 38;

/**
 * The font size a node's header name needs to be READ WHOLE, in px.
 *
 * The header used to ellipse at a fixed 12.5px, which was fine while every card was NODE_W —
 * and stopped being fine when a card became only as wide as its panel's grid. A two-column
 * strip is 84px, a few characters, so seventeen identically-shaped mixers all read "vo_j…".
 * A name you cannot read is a card you have to hover to identify.
 *
 * Estimated from the glyph count rather than measured: this runs for every node on every
 * layout, and a DOM measurement per card is a reflow per card. `GLYPH_W` is the average
 * advance of the header's face at 1px — it is an average, so a name of all `m`s still
 * ellipses and a name of all `i`s is left smaller than it had to be. Both are better than
 * the fixed size they replace.
 *
 * Never LARGER than the size it had, only smaller: this is about fitting a long name, not
 * about blowing up a short one, and a card whose title grew would look like a different kind
 * of card. Floored too — below `HEADER_MIN_PX` it is a smudge, and an ellipsis is honester.
 */
export const HEADER_MAX_PX = 12.5; // .dgx-nm's size today, and the ceiling
export const HEADER_MIN_PX = 7.5;
const GLYPH_W = 0.55; // average advance per px of font size, for the header's face

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

/**
 * How big a NOTE has to be to show its text — dagre is told this, so a note reserves real space
 * rather than overlapping the chain it is about.
 *
 * Wrapped at `NOTE_MAX_W` rather than widened without limit: one long paragraph would otherwise
 * push every rank of the graph sideways to make room for prose, which is the opposite of what a
 * note is for. The height then follows the WRAPPED line count, so the box fits what is drawn.
 */
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
/**
 * One row, separator included — 15px of line plus the 1px rule above it (`.dgx-clip`).
 *
 * These two have to track the CSS in `DomChains`, because dagre is told the height here and
 * draws nothing: a row taller than this reserves too little and the last clip spills out of the
 * card. The first row has no rule, so the box is 1px of slack rather than 1px short — the
 * harmless direction to be wrong in.
 */
const CLIP_ROW_H = 16;
/** The list's bottom padding, plus the rule that separates it from the controls above. */
const CLIP_LIST_PAD = 7;
/** The mini timeline above the list: its track, plus the gap under it (`.dgx-clip-tl`). */
const CLIP_TIMELINE_H = 14;
/**
 * The narrowest a clip block is drawn, as a fraction of the timeline.
 *
 * ~3px on a 160px node. A one-bar clip in a six-minute song is a fraction of a percent, and a
 * block that thin is both invisible and impossible to hover — so the floor is what keeps the
 * timeline usable for finding things, which is the only thing it is for.
 */
const CLIP_MIN_W = 0.02;

/**
 * The clip list of a TRACK node, and the extra height it needs — spread in beside its size.
 *
 * The height ADDS to the mixer grid's rather than replacing it: a track node draws its five
 * controls and then what the lane holds, so both have to fit. A lane with no clips gets nothing
 * at all — not an empty list and not a heading — because a node that says "0 clips" is a node
 * that has grown to tell you nothing.
 */
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
    // A graph whose clips all sit at bar 1 has no span to divide by; everything is at the start,
    // which is exactly where 0 puts it.
    const at = span > 0 ? Math.min(1, Math.max(0, c.start / span)) : 0;
    const w =
      span > 0 && c.len ? Math.max(CLIP_MIN_W, c.len / span) : CLIP_MIN_W;
    // Clamped to the right edge: a clip running past the last START — the longest one usually
    // does — must end at the edge rather than draw outside the card.
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

/**
 * The scale every track node's mini timeline is drawn against: the last position in the GRAPH.
 *
 * Shared rather than per-lane, which is the whole point of it — a mini timeline is read by
 * comparing lanes, and one that rescaled itself per track would draw every lane's last clip
 * hard against its right edge whether that was bar 3 or bar 300.
 */
function clipSpanOf(graph: WebGraph): number {
  let span = 0;
  // The END of the last clip, not its start: a lane whose final clip runs eight bars would
  // otherwise be drawn as ending where that clip BEGINS, and the block would hang off the
  // right of every node in the graph.
  for (const clips of Object.values(graph.trackClips ?? {}))
    for (const c of clips) span = Math.max(span, c.start + (c.len ?? 0));
  return span;
}

/**
 * The note bits of a module node, or nothing — spread into the node beside its size.
 *
 * A module is a note exactly when the graph's `modules` map holds it: that map is keyed by DOC
 * modules and nothing else (see the file service's graphDoc.ts), so asking it is the whole test.
 */
function noteOf(
  g: WebGraph,
  module: string,
): { note: string; w: number; h: number } | Record<string, never> {
  const meta = g.modules?.[module];
  if (!meta || meta.content === undefined) return {};
  const text = meta.content;
  return { note: text, ...noteSize(text) };
}

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

/** The bind prefix a rack pad carries: `@rack:BD` fires the sound `BD`. See `rackUI`. */
export const RACK_BIND = "@rack:";

/** The symbol a rack-pad bind names, or null for any other bind. */
export const rackBindSymbol = (bind: string | undefined): string | null =>
  bind?.startsWith(RACK_BIND) ? bind.slice(RACK_BIND.length) : null;

/** The widest a pad grid gets — it keeps a sixteen-sound rack from drawing a node wider than
 *  the pane, and four is the shape a drum grid already has. */
const RACK_COLS = 4;
/** …and the smallest. A rack is a GRID of pads, so it reads as one even holding a single sound:
 *  two pads in a row look like two controls, four in a square look like a rack with three
 *  slots free — which is what it is. */
const RACK_MIN = 2;

/**
 * The shape a pad grid takes for `n` sounds: square-ish, never under 2×2, never over four wide.
 *
 * Square-ish rather than filling rows of four, because the node is read as a PAD GRID and a
 * 4×2 block of eight says less about the instrument than a 3×3 does. Exported for the test that
 * pins the corners of that rule.
 */
export function rackGrid(n: number): { cols: number; rows: number } {
  const cols = Math.max(
    RACK_MIN,
    Math.min(RACK_COLS, Math.ceil(Math.sqrt(Math.max(1, n)))),
  );
  return { cols, rows: Math.max(RACK_MIN, Math.ceil(Math.max(1, n) / cols)) };
}

/**
 * The UI a RACK node carries: one button per sound it has loaded.
 *
 * Synthesised rather than authored, exactly as `TRACK_UI` is, and for the same reason — the
 * controls are not the module's opinion but what it IS. A rack's sounds are known (its symbols,
 * merged through `extends`), so asking someone to also write a `ui.yaml` listing them would be
 * asking them to keep two lists in step.
 *
 * The binds are `@rack:<symbol>` — a node INTRINSIC in the same family as `@mute`, routed by the
 * renderer rather than to a plugin param. A pad is not a param: it fires a sound and returns,
 * which is why it needs a target kind of its own (see `widgetTarget`).
 *
 * An AUTHORED `ui.yaml` wins over this. A rack with a hand-made panel has said what it wants its
 * node to show, and a grid of pads bolted underneath would be the app overruling the file.
 *
 * The grid is `rackGrid`'s — at least 2×2, so a rack always reads as a rack. The `label` is still
 * the symbol, and is still what a right-click and a tooltip name the pad by; whether it is
 * PRINTED on the pad face is the renderer's business, and it is not (see DomChains): sixteen
 * three-letter words in a card this size is a wall of text where a drum grid should be.
 */
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

/**
 * The UI a live INPUT node carries: what socket it is on, how wide, and when it is audible.
 *
 * Synthesised for the same reason `rackUI` and `TRACK_UI` are — these are not the module's opinion
 * but what it IS — and here there is a second reason, harder: `@engine/IN` is a built-in with no
 * folder in any library, so a `ui.yaml` for it is not merely unwritten but IMPOSSIBLE to key
 * (see @studio/song's uiLibrary.ts). Every input in every project therefore drew a card saying
 * "No Options" until this existed.
 *
 * All three are dropdowns, and that is a constraint rather than a taste: only a widget carrying
 * `options` can commit a module field — `setModuleField` in the renderer reads the picked option's
 * `arg`, so a knob bound to a field draws, drags and writes nothing. `@gain` is deliberately absent
 * for that reason, and only that one: a continuous trim has no options to pick. (It is no longer
 * for want of a verb — `node param <node> @gain <db>` exists; what is missing is a
 * commit-on-release path for a dragged intrinsic.)
 *
 * The channel list is the MACHINE's, so it arrives as an argument rather than being invented here:
 * the sets are what `findWaveInput` matches exactly, and offering a channel the interface does not
 * group that way reads as silence (see @studio/engine-browser's EngineInputDevice). With no
 * interface answering the dropdown is empty and only the other two draw.
 *
 * An AUTHORED panel wins over this, exactly as for a rack: a node that has written its own has said
 * what it wants to show.
 */
export function inputUI(
  devices: readonly { name: string; channels: number[] }[],
  channel: readonly number[] | undefined,
): WebModuleUI {
  const stereo = channel?.length === 2;
  const first = channel?.[0] ?? 1;
  // The socket list offers the CURRENT width. The other width is a different question, asked by the
  // control beside it — one list of every mono input AND every pair is thirty entries on a rig like
  // this one, and the answer to "which preamp" is not thirty things long.
  const sets = devices.filter((d) => d.channels.length === (stereo ? 2 : 1));
  // Width writes `channel:` too, rather than being a field of its own: mono and stereo are not two
  // settings, they are how wide ONE setting is. A pair is even/odd — the interface groups no other
  // way — so the pair containing channel n starts at n rounded down to odd.
  const odd = first % 2 === 1 ? first : first - 1;
  const widgets: Record<string, WebWidget> = {
    // `value` is a position in the list and nothing more: the channels travel in `arg`, because a
    // set is not a number and the command has to receive it as written.
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

/**
 * Fill in the options of any widget bound to `@base` — the module's own bases, from the folder.
 *
 * The panel cannot carry them and must not try: which bases exist changes every time somebody
 * snapshots one, and a `ui.yaml` listing them would be a copy of a directory going stale between
 * saves. So the author binds a dropdown to `@base` and says nothing about its entries; the graph
 * fills them from what the loader found (`bases` on the step).
 *
 * Exactly what `inputUI` does for `@channel`, and for the same reason — those sets are the
 * machine's, these are the folder's, and neither is the panel's to know. The value is a position
 * in the list and nothing more: `setModuleField` writes the option's LABEL, which is the base's
 * name, so adding a base can renumber the list without changing what any entry writes.
 *
 * `none` first and always, because a chosen base has to be undoable: without an entry meaning
 * "back to the module's default" the only way out of a base is editing the file by hand.
 */
function withBaseOptions(
  ui: WebModuleUI,
  bases: readonly string[] | undefined,
): WebModuleUI {
  const binds = Object.values(ui.widgets ?? {}).some(
    (w) => w.bind === BASE_BIND,
  );
  if (!binds) return ui;
  const options = [
    { label: "none", value: 0 },
    ...(bases ?? []).map((b, i) => ({ label: b, value: i + 1 })),
  ];
  const widgets: Record<string, WebWidget> = {};
  for (const [id, w] of Object.entries(ui.widgets ?? {}))
    widgets[id] = w.bind === BASE_BIND ? { ...w, options } : w;
  return { ...ui, widgets };
}

/** The bind a base dropdown carries — the intrinsic's name, verbatim, as every bind is. */
const BASE_BIND = "@base";

/** The panel a step actually draws — authored first, then the two synthesised ones. One function so the
 *  node's SIZE and the node's `ui` cannot disagree about which panel it is. */
function stepUI(
  s: WebChainStep,
  devices: readonly { name: string; channels: number[] }[] | undefined,
): WebModuleUI | undefined {
  // The base list is folded into whichever panel is drawn, authored or synthesised, because a
  // widget bound to `@base` is a widget wherever it came from.
  if (s.ui) return withBaseOptions(s.ui, s.bases);
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
  if (curve.type === "lfo") return `lfo ${curve.shape ?? "sine"}`;
  // An envelope says so rather than borrowing "custom": it is the one curve here that is not a
  // function of song time, and a reader who cannot tell the two apart cannot tell why one of
  // them has a socket on its left.
  return curve.type === "adsr" ? "adsr" : "custom";
}

// Build nodes and unpositioned edges from the chain graph, mirroring the signal path. See docs/graphBuild.md.
export function buildGraph(
  graph: WebGraph,
  opts: {
    /**
     * Draw a card for the main output. The DEFAULT, and st0's song graph is what turns it off.
     *
     * In a song, reaching the card is what the end of a chain means — a mixer sits there and
     * its whole job is the level going out — so a node saying "OUT" adds a card, an edge and a
     * rank to every chain to repeat what the shape already says. st0 therefore asks for it to be
     * left out (`ChainsTab`).
     *
     * On by default all the same, because the other pictures built from this are not songs: the
     * module preview is one module between a source and a sink, with no mixer in it to imply
     * anything, and there the sink is what says which way the signal runs.
     */
    drawMainOut?: boolean;
    /**
     * How the machine's interface groups its inputs, for the socket dropdown a live input draws.
     *
     * An argument because it is the one thing on a node that is not in the document: which inputs
     * exist is the sound card's to say, and it differs between the machine that wrote the song and
     * the machine playing it. Absent ⇒ the dropdown is empty and the input still draws its width
     * and its monitoring, which is the honest picture with no engine attached.
     */
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
    }
    return id;
  };
  // The maximum step index a module holds across chains, so a shared one ranks after every pipeline it is in.
  const moduleRank = new Map<string, number>();

  // The FROZEN pass was here — which lanes played a render of themselves, and which modules were
  // therefore inside it. Freezing is gone with the field it read (packages/song/docs/trackModules.md).
  // Once for the whole graph, so every lane's mini timeline is drawn against the same ruler.
  const clipSpan = clipSpanOf(graph);
  /**
   * Add a connection once — but "once" is per SOCKET, not per pair.
   *
   * Two things are true at the same time and the key has to serve both. The same link can be
   * expressed from either end (`A.out: [B]` and `B.from: A`), and only one of the two carries
   * ports — so those must collapse into one arrow. And a module that splits feeds one target
   * from several of its outputs (`sep#drums: [mix]`, `sep#bass: [mix]`), which are genuinely
   * different cables — those must NOT collapse. Keying on the pair alone drew the second as
   * the first, leaving one arrow out of the wrong jack; that is what this fixes.
   *
   * So: an expression that names ports gets its own identity, and one that names none merges
   * into whatever cable already joins the pair. Order-independent, which matters because the
   * two ends are visited in whatever order the chains happen to be in.
   */
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
    // A cable already here that this expression could BE: same source port, or one of the two
    // says nothing about ports and so cannot be contradicting the other.
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
      // Read once: the node's panel and the node's size are the same answer, and asking twice is
      // how they came apart in the first place.
      const ui = stepUI(s, opts.inputDevices);
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
        module: s.module,
        // …and whether it is inside somebody's render. From the graph rather than from the step
        // for the reason a lane's is: freezing is a fact about the whole signal path, so the one
        // map answers for a lane and a module alike.
        ...(graph.frozen?.[s.module] ? { frozen: graph.frozen[s.module] } : {}),
        // Everything the step itself says, in one move — see CARRIED/FLAGS. Listing them here
        // is what let `assetChoices` reach the browser and stop short of the node.
        ...carryStep(s),
        // The panel the node actually DRAWS, over the raw one `carryStep` brought: the authored
        // grid with its base list folded in, or the one synthesised for a rack or a live input.
        // `stepUI` answers that once for both readers — the node used to pick the panel here and
        // the size from `stepUI`, and the two agreed on everything except the one thing only
        // `stepUI` did: a widget bound to `@base` had its entries computed and then dropped, so
        // that dropdown drew "none" alone on every card in the app.
        ui,
        ...nodeSize(ui), // as big as its grid needs
        // …and a NOTE is as big as its text. `g.modules` is keyed by doc modules alone, so a
        // hit here IS "this node is a note" — no second field, and no lookup table to keep in
        // step with one. The size overrides the one above: a note has no widget grid.
        ...noteOf(graph, s.module),
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

      /**
       * One curve node PER BINDING — so the same curve may appear several times.
       *
       * This is a REVERSAL, and the reason the old rule died is worth keeping. It used to be one
       * node per curve: a curve was one thing however many params it drove, each binding an edge
       * out of the same card, and drawing it twice was duplication that made "where is this
       * curve" two answers.
       *
       * That held while a curve node had no INPUT. It has one now — an envelope is restarted by
       * an event, and which module fires it is per binding. One card with two event sockets
       * could not say that the same shape is fired by the drums here and by the synth there;
       * two cards say it by standing apart. The shape is still one file on disk, and the label
       * is still the curve's id, so the two instances are legibly the same curve.
       *
       * The id carries the binding, which is what makes them distinct nodes rather than one.
       */
      for (const a of s.automations ?? []) {
        const curve = graph.curves?.[a.curve];
        if (!curve) continue; // the curve was dropped (missing file) — nothing to draw
        boundCurves.add(a.curve);
        const cid = `crv:${a.curve}@${s.module}:${a.param}`;
        add(cid, {
          label: a.curve,
          sub: curveSubLabel(curve),
          kind: "curve",
          // Only an envelope has anything to be restarted BY. The socket is what says so, and
          // it is why the two curve kinds are told apart in the node's second line.
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
        // …and, for an envelope, the cable that FIRES it: from the announcing module's note-on
        // into the curve's event socket. It runs the other way to the automation edge above —
        // events in, values out — which is what makes the pair readable as a loop on the graph.
        //
        // The trigger defaults to the module being automated, which is what the compiler does
        // (nodeProject.ts). Drawn from the same field, so the picture cannot claim one source
        // while the bake uses another.
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
          // A lane is a module node, so it is addressable like one — which is what the
          // alternatives menu on its card acts through. See packages/song/docs/alternatives.md.
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
          // …and again to fit what the lane HOLDS. A routing diagram that showed where a
          // track's signal goes but never what it plays made you open the timeline to answer
          // "which take is on this lane" — a question about the lane, asked at the lane.
          ...clipsOf(graph, c.from, nodeSize(ui), clipSpan),
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
      // OUT is not drawn. Reaching the card is what the END of a chain MEANS — a mixer sits
      // there and its whole job is the level going out — so a card saying "OUT" adds a node,
      // an edge and a rank to every chain in the song to repeat what the shape already says.
      // The routing is untouched: this is the picture, and the engine reads the compiled doc.
      //
      // Only OUT. A destination that is not a track, a chain or a used module is still drawn as
      // a sink, because THAT one is a name the graph cannot otherwise account for.
      if (toNode === MAIN_OUT && opts.drawMainOut === false) continue;
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
  /**
   * The curves nothing binds — drawn free-standing, one card each, driving nothing yet.
   *
   * A curve is a node like everything else here, so `curve new` has to put something on the
   * graph: an unreferenced curve used to draw nothing at all, which made the verb's result
   * invisible and the canvas menu's "add a curve" a promise with no picture behind it.
   *
   * Its id has no binding in it, which is exactly what tells it apart from an instance: one
   * free card per curve, and one bound card per binding.
   */
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
    // A live INPUT is a SOURCE: nothing plugs into a preamp, and the socket it listens on is a
    // param picked on its card, not a hole on its edge. `monitor` is the marker for the reason
    // `inputUI` gives — the file service sets it for an io "in" step and for nothing else.
    const source = n.monitor !== undefined;
    n.jacks = {
      // A lane takes a feed like anything else. What it PLAYS is its clips, which was never a
      // reason for nothing to be able to ARRIVE on it. Typed by what the lane puts on the wire,
      // so a midi lane offers a midi socket rather than the audio every unfed jack falls back to.
      in: source
        ? []
        : jacksFor(
            n.inputs,
            fed.get(n.id) ?? NONE,
            arriving.get(n.id) ??
              (n.kind === "track" ? leaving.get(n.id) : undefined),
            true,
          ),
      // A sink is the mirror image of a source — somewhere to arrive, nowhere to leave.
      out:
        n.kind === "sink"
          ? []
          : jacksFor(
              n.outputs,
              left.get(n.id) ?? NONE,
              leaving.get(n.id),
              false,
              // A lane's outputs are its SENDS, so a taken one grows a spare. See jacksFor.
              n.kind === "track",
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

/**
 * Pull the named modules onto ONE rank, so they line up as a row in the graph they already live in.
 *
 * The mixer view is this and nothing else: the same graph, the same cables, the same cards — only
 * the ranks move. Every track ends on a mixer, but a track with a longer chain ends DEEPER, so by
 * default the mixers sit on a staircase and no zoom shows them all. Given a shared rank, dagre
 * lays them side by side, evenly spaced by its own `nodesep`, and re-ranks whatever has to move
 * to keep every edge pointing down the page.
 *
 * The shared rank is the DEEPEST of theirs, never a shallower one: pulling a mixer up would put it
 * above modules that feed it, and an edge that has to climb is a cable drawn backwards.
 *
 * Sinks are pushed past it for the same reason — they carry a rank of their own, computed before
 * this ran, which the move can leave sitting above the row that feeds them.
 *
 * Returns a new array; the input nodes are not touched, so the plain layout stays available to
 * anything drawing the same graph beside this one.
 */
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
    if (n.kind === "sink" && (n.rank ?? 0) <= shared)
      return { ...n, rank: shared + 1 };
    return n;
  });
}

/**
 * Re-space the named modules evenly along x, AFTER dagre has laid the graph out.
 *
 * `alignModuleRank` puts them on one line; this gives them one rhythm. dagre spaces a rank by
 * what is above it — a track with a wide chain pushes its mixer away from its neighbour — so a
 * shared rank alone still reads as a scattered line rather than a console. Here the gap between
 * two strips is the same gap, whatever feeds them.
 *
 * The ORDER is the caller's, the song's track order, for the same reason `moduleRow` takes it:
 * a console's channels are numbered by the song, not by where a layout engine happened to put
 * them. Equal GAP and not equal pitch, because the cards are not all the same width and it is
 * the space between them the eye reads as regular.
 *
 * What this costs is upstream: the chains that feed the row are no longer straight columns, and
 * they are not meant to be. Nothing has to be done about their cables — `cablePath` draws a
 * straight line between the two sockets and reads the nodes for both ends, so a card that moves
 * takes its cable with it. This used to drop dagre's waypoints by hand, back when they were the
 * route and a moved card left them describing a bend around nothing.
 */
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

  // Start where the row already begins, so turning the view on slides the cards together rather
  // than carrying them off to the origin.
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
    // The sweep only moves cards along their own row, starting where that row already began, so
    // neither end of the drawing moves.
    left: laid.left,
    top: laid.top,
  };
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
  opts: {
    /** Widen each card by this much. The GRID inside it is a fixed cell size and stays where it
     *  is, so this is elbow room around the controls rather than bigger controls — a row of
     *  strips read side by side asks for 1.5, where a tight card reads as cramped. */
    widthScale?: number;
    /**
     * Carry the CABLES between these modules, and meet them on the sides.
     *
     * Off for a rank of channel strips: nothing runs between two channels, so every socket would
     * be a plug into nothing — furniture, and furniture between the strips at that. On for one
     * lane's signal path, where the cables ARE the subject: they say what feeds what, and a send
     * that skips a module shows as the longer cable it is.
     *
     * The edges are the graph's own, kept where both ends are in the row. Nothing is invented
     * between neighbours: two cards side by side with no cable between them is the truth about a
     * lane whose chains do not touch.
     */
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
  // One height for the whole row, the tallest card's. A ragged bottom reads as cards of
  // different importance, and the camera fits the row's height to the view — so with one height
  // every card IS the height of the view rather than the tallest one being it alone.
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
      // Sockets are never PLATED here: the plates are CSS-pinned to the top and bottom edges, and
      // this row meets its cables on the sides. `flow` is what moves the cable's ends; drawing a
      // plug on the wrong edge would be worse than drawing none.
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
            // A row has no dagre route to inherit and wants none: it draws straight.
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

/**
 * Put every node on the LINE OF ITS OWN RANK, after dagre has placed them.
 *
 * The ranks are already computed and handed to dagre (`n.rank`, in buildGraph), and dagre treats
 * them as a suggestion: its `longest-path` ranker pushes a node as LATE as it can, hugging the
 * sink below it. Measured on a fifteen-track song: rank 1 spread over SIX lines, from y=16 to
 * y=1380 — a first-in-chain module sitting on the mixer line, at the bottom of a column it
 * should have been at the top of. Which is exactly what a stretched chain looks like when the
 * mixers are pinned deep and the one module above them is dragged down to meet them.
 *
 * So the rank is made to mean what it says: one row per rank, in order, each as high as the
 * highest thing dagre put there — and never overlapping the row above, which is the one thing a
 * naive snap gets wrong. Rows are stacked with `RANK_SEP` between them, the same gap dagre used.
 *
 * Only the y. The x is dagre's throughout, so the spacing along a row varies with what hangs
 * under each column — right for the tracks and the modules, which are the tops and middles of
 * chains of different widths. The mixer row asks for even spacing separately
 * (`spaceModulesEvenly`), because a rank of channel strips is the one place it is wanted.
 *
 * A node with no rank keeps the y dagre gave it: nothing here claims to know better.
 *
 * The rows are then SWEPT for collisions, and that is not an afterthought: dagre places x
 * assuming its own y, so two nodes it put on different lines may share a column, and collapsing
 * them onto one row is what makes them overlap. Measured: one such pair on a fifteen-track song,
 * a module nested inside another. The sweep walks each row left to right and pushes whatever
 * would land on its neighbour past it, by the same `nodesep` dagre separates siblings with.
 */
function snapToRankRows(
  placed: GraphNode[],
  // The ranks live on the RAW nodes — `GraphNode` is what a renderer gets, and a rank is an
  // instruction to the layout, not a fact about the drawing.
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

// Position with dagre and KEEP its routed edge points, so a send that skips a column bends around the module.
// dagre returns centres; we store top-left, while edge points stay in the same absolute graph space.
export function layout(
  nodes: RawNode[],
  raw: RawEdge[],
  // Where somebody PINNED nodes (chains.yaml `positions:`, by chains name): those win over
  // everything the ranker decided, and dagre only ever places what has no entry — a module
  // dragged once stays where it was put, a new one still arrives laid out.
  positions?: Record<string, { x: number; y: number }>,
  // Where each node was DRAWN last time, by node id — the host's session memory. A node in
  // this map stays exactly there, so an edit (a cable pulled, a module dropped in) never
  // reorganizes the picture: dagre still runs, but its answer lands only on nodes it has
  // never placed. Pins outrank it (the file outranks the session — another tab may have
  // written one); `graph organize` is the command that empties both and lets dagre speak.
  prev?: ReadonlyMap<string, { x: number; y: number }>,
): LaidOutGraph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    // Signal runs DOWN the page. `nodesep` and `ranksep` swap axes with it: `nodesep` is now
    // the gap between siblings side by side, `ranksep` the gap between one stage and the next.
    // The numbers swap with them — a card is 160 wide and 70 tall, so side-by-side wants the
    // larger figure and stage-to-stage the smaller, or the graph reads as a sparse column.
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
    // The same name resolution the edge inserts and the jacks use (cables.ts's jackRef,
    // inlined here because cables imports this file): a module by its chains name, the rest
    // by label. Applied AFTER the rank snap and BEFORE the extents, so a pinned or held
    // node both wins over the rows and still counts toward the graph's measured size.
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
    // Carried through, and it was not: `targetPort` was set on the raw edge and then dropped
    // here, so the jack a cable names never reached the renderer at all. Every ported cable
    // landed on the node's edge like an unported one — the drawing said the port was a detail.
    targetPort: e.targetPort,
    sourcePort: e.sourcePort, // the mirror, and it drops the same way if forgotten here
    points: g.edge(e.source, e.target, e.id)?.points ?? [],
  }));
  // Measured on the NODES, not read off dagre. `snapToRankRows` moves them after dagre has
  // reported its own extent, so that figure describes a picture that no longer exists — 488px
  // short on a fifteen-track song, which is the bottom of the graph missing from every fit.
  //
  // An empty layout has no extent: say 0. It used to say -Infinity, which `?? 0` never caught
  // and `if (!width)` passed, so the view framed to infinity and reported success — invisible,
  // and convinced it was already framed. See docs/graphBuild.md.
  const extent = (of: (n: GraphNode) => number): number =>
    outNodes.length ? Math.max(...outNodes.map(of)) + GRAPH_MARGIN : 0;
  // …and the other end of the same measurement, which is 0 until a pin puts a card above the
  // first row or left of it. Never positive: the drawing starts at the origin at the latest,
  // so a graph laid out normally frames exactly as it always did.
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
