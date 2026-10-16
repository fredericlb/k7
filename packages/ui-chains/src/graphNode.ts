// graphNode.ts — the shapes the chains graph is made of: a node, a cable, the jack and the point
// they are drawn from, and what a node carries over from its chain step. Types only, apart from
// `carryStep`, which is the one place the step-to-node copy is spelled. See docs/graphBuild.md.

import type { CurveSpec, WebChainStep, WebSignal } from "@studio/graph-model";
import type { AutomationDepth } from "./automationDepth";

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
  // …and which LENS a camera is on, carried for exactly that reason — see docs/camera.md.
  "camera",
  // …and which MIDI DEVICE a midi-in node records from, the same way — @studio/song's docs/midiIn.md.
  "device",
  "tap",
  // The module's other attribute sets, and which is on — see packages/song/docs/alternatives.md.
  "alternatives",
  "alternative",
  // …and its engines, and which runs — see packages/song/docs/engines.md.
  "engines",
  "engine",
  // A rack's loaded sounds: `rackUI` draws the pads and the renderer reads the row back.
  "rack",
  // …and whether they are an SFZ kit's, fixed and played as notes — packages/song/docs/racks.md.
  "rackKit",
  // What the module ANNOUNCES — its note-on, drawn as one socket per name.
  "events",
  // Which named base this module is on: the LIST becomes the dropdown, this says which entry is on.
  "base",
  // …and which SHADER a shader node runs, carried for the same reason `base` is.
  "shader",
  // The module this node is a USE of — the header draws it as the card's name.
  "uses",
  // …and where an unnamed node sits, which every text that would show its uuid shows instead.
  "place",
  // The engine's stage the card draws on its header's second line — docs/graphBuild.md.
  "stage",
  // A lane's strip, whose header draws neither the bypass nor the alternative badges.
  "strip",
  // A model the machine has not got and can download — what the right-click offers to fetch.
  "modelDownload",
  // …and the model it HAS loaded, which a panel's widgets.js reads — ui-chains-react's lcdScreen.md.
  "ampModel",
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
export function carryStep(s: WebChainStep): Carried & Flags {
  const out: Record<string, unknown> = {};
  for (const k of CARRIED) out[k] = s[k];
  for (const k of FLAGS) out[k] = !!s[k];
  return out as Carried & Flags;
}

export type Kind =
  | "track"
  | "module"
  | "chain"
  | "sink"
  | "curve"
  // A templated set of nodes drawn as one box — a DRAWING, never a signal. See docs/graphBuild.md.
  | "assembly";

/** A node as the renderer receives it: its step's fields (DERIVED, see CARRIED/FLAGS) plus geometry. */
export interface GraphNode extends Carried, Flags {
  id: string;
  label: string;
  /** The card's width with each TAB open, when a responsive fold gave the tabs different widths (gridFit.ts). */
  tabW?: number[];
  /** …and its height with each tab open, in the vertical layout, whose pages differ in length (`withOpenTabs`). */
  tabH?: number[];
  sub?: string; // secondary line (the owning chain name on a chain's first module)
  kind: Kind;
  // track only: this lane carries PICTURE. A flag, not a kind — it ranks, links and lays out like an audio lane.
  video?: boolean;
  color?: string; // track only: the track's authored display colour (hex), if any
  /** This module is a lane's FADER, and this is the lane: the card wears its glyph and its name (docs/graphBuild.md). */
  trackFace?: string;
  chain?: string; // owning chain (modules + empty pass-through chains) — first if shared
  chains?: string[]; // all chains this module belongs to (when shared across chains)
  dim: boolean; // bypassed (module or whole chain)
  module?: string; // the module node name (for the nativePluginUI open)
  bypassed?: boolean; // the chain step is `enabled: false` — passes its input through
  /** BAKED into a render — not `dim`, which is one click from audible. See packages/song/docs/freeze.md. */
  frozen?: "at" | "inside";
  /** Baked into an AUTOMATIC VST freeze — the VST module whose render holds it; touching a control thaws it (packages/song/docs/autoFreeze.md). */
  autoFrozen?: string;
  // A node that does not exist yet: the module being created, drawn where it will land.
  pending?: boolean;
  /** Drawn as a full-width BAR — the stack view's inputs and outputs (stackLayout.ts). */
  bar?: boolean;
  /** Drawn with NO header, its panel lifted into that space — a pinned card no cable meets (anchorRight.ts). */
  bare?: boolean;
  /** The sockets to DRAW, already decided — see `jacksFor` and docs/graphBuild.md. */
  jacks?: { in: Jack[]; out: Jack[] };
  /* `events` is CARRIED from the step and drawn apart from `jacks.out` — see docs/graphBuild.md. */

  /** This node LISTENS for events: one socket on its left edge, above the signal ones. */
  eventIn?: boolean;
  /** The RENDER sum's own field, set by `renderCard`: the FRAME's shape, an index into `RENDER_UI`'s rows. */
  aspect?: number;
  /** A curve node's BINDING, carried rather than parsed back out of the id — see docs/graphBuild.md. */
  curveOf?: { curve: string; module?: string; param?: string };
  /** …and the curve itself, so its card draws the picture the curve editor does. */
  curveSpec?: CurveSpec;
  /** This node sits in a row read ACROSS, so its cables meet the side edges — `moduleRow`'s doing. */
  flow?: "across";
  /** Which assembly this node is INSIDE — set on the members of an open box, and on nothing else. */
  assembly?: string;
  /** Where this node belongs, having STEPPED ASIDE for an open frame — never written down (`pushAsideFrames`). */
  pushed?: Pt;
  /** …and, on the BOX, what it is. `plugs` is what turns a plug into a graph.yaml address. */
  assemblyOf?: {
    uses: string;
    open: boolean;
    /** The project node names this box holds — all that is left of them once it is CLOSED. */
    members: string[];
    plugs: Record<string, { node: string; port?: string }>;
    params?: Record<string, { node: string; param: string; pluginId?: string }>;
    missing?: boolean;
  };
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

// An automation edge's payload: a curve feeding a module's param. Undefined on a signal edge.
export interface EdgeAutomation {
  param: string; // the param the curve drives — the edge's label / the fallback text
  // The target widget's node-local centre when the module draws one; absent ⇒ the arrow lands on the border.
  widget?: Pt;
  /** How far the curve moves the param — what the knob draws as its purple gauge; absent for an on/off curve. */
  depth?: AutomationDepth;
}

export interface GraphEdge {
  /** The open assembly this cable is INSIDE, both ends members; a cable crossing the frame has none and draws faded. */
  assembly?: string;
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
  /** Its rank among the BARE cables reaching this target, so each gets a socket of its own — docs/graphBuild.md. */
  targetSlot?: number;
  /** A cable that SKIPS cards of its stack column: it runs down the column's right side, in lane `side` (stackLayout.ts). */
  side?: number;
  /** Its two cards TOUCH in a glued row: no cable is drawn, but the signal still flows through it (rowSeams.ts). */
  glued?: boolean;
  points: Pt[]; // dagre's routed polyline, absolute graph coords
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
  /** Not a splice but a STACK under `before` — a chain project's bottom `+` (rowSeams.ts). */
  stack?: boolean;
}

// A track's live mixer state (volume in dB, pan 0..1, flags 0/1), on its own channel.
export interface TrackControlValues {
  volume: number;
  pan: number;
  mute: number;
  solo: number;
  arm: number;
  /** Heard 10 dB up from the mixer's highlight button — packages/song/docs/highlight.md. */
  highlight?: number;
}

export interface RawNode extends Omit<GraphNode, "x" | "y"> {
  rank?: number; // dagre rank hint — computed from longest chain position
}
export interface RawEdge {
  id: string;
  /** See `GraphEdge.assembly` — set by `foldAssemblies`, carried through the layout. */
  assembly?: string;
  source: string;
  target: string;
  label?: string;
  automation?: EdgeAutomation;
  signal?: WebSignal; // what the cable carries — see GraphEdge.signal
  targetPort?: string; // which INPUT of the target it lands on — see GraphEdge.targetPort
  sourcePort?: string; // …and which OUTPUT it left from — see GraphEdge.sourcePort
  targetSlot?: number; // its rank among the bare cables arriving — see GraphEdge.targetSlot
  weight?: number; // dagre edge weight — higher pulls endpoints closer
}
