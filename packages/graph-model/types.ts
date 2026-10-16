// types.ts — the chains routing graph as the browser receives it (mirrors the essentials
// of the song compiler's GraphDoc). Almost all types, plus the handful of values both sides
// must agree on BY VALUE — the port separator and the category list. Lives apart from
// @studio/web-protocol so that drawing a graph drags in neither auth, nor workspaces, nor
// the engine registry.

export interface WebOut {
  to: string; // a chain name or an io sink (e.g. "OUT")
  gain: number; // 0..1 share (1 == whole signal)
  // Which OUTPUT this edge left from (`sep#vocals: [ reverb ]`); absent on the single output most modules have.
  fromPort?: string;
}
// One widget on a module's UI grid — the wire copy of the brain's Widget; `hidden` is resolved away by the merge.
export interface WebWidget {
  type:
    | "label"
    | "knob"
    | "slider"
    | "fader"
    | "number"
    | "toggle"
    | "button"
    | "meter"
    | "waveform"
    | "dropdown"
    // Picks a FILE the module carries for the file-valued param it binds — see filePicker.md.
    | "filepicker"
    // A screen the panel's `widgets.js` draws under this widget's id — ui-chains-react's lcdScreen.md.
    | "lcdscreen"
    // One sound of a rack: a pad, its note and its library sample — packages/song/docs/racks.md.
    | "tap"
    // A coloured frame under the widgets inside its box — packages/song-schema/docs/moduleFile.md.
    | "group";
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  text?: string; // label only
  bind?: string; // everything but label/waveform: the param it reads/writes
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  // waveform only: which audio tap to display, or "take" for a RECORDER node's own picture —
  // the whole take, growing, off the state frame rather than a tap (engine docs/recorder.md).
  source?: "input" | "output" | "take";
  // dropdown only: a discrete param's named settings, `arg` differing from the label — see docs/graph.md.
  options?: { label: string; value: number; arg?: string }[];
  // dropdown only, HISTORICAL: the older spelling of a filepicker, still read as one — docs/graph.md.
  library?: string;
  color?: string; // group only: its background, a #rgb / #rrggbb / #rrggbbaa colour
  invert?: boolean; // group only: its bind is a MUTE or BYPASS — the section is on while the param is off
  pair?: string; // knob only: the DRY param a crossfade knob sets beside its `bind` (wet), equal-power
}
export interface WebModuleUI {
  cols: number;
  rows: number;
  // Drawn on every tab — and the whole panel when there is one tab or none.
  widgets: Record<string, WebWidget>;
  // The panel's pages in order; two or more are drawn as a column at the card's left (graph-model's panel.ts).
  // `cols`: what THIS tab needs once a responsive fold has run (ui-chains' gridFit.ts); absent, the panel's own.
  tabs?: { name: string; widgets: Record<string, WebWidget>; cols?: number }[];
  // The `widgets.js` source beside the panel, run by the BROWSER to draw its lcdscreen widgets.
  script?: string;
  // The panel laid out NARROW (at most 4 columns), for a card read down; absent, the panel serves both shapes.
  vertical?: Omit<WebModuleUI, "script" | "vertical" | "tabsAs">;
  // How the pages are offered: a column at the card's left (the default), or a menu across its top — a narrow card's.
  tabsAs?: "column" | "dropdown";
}
/** What a wire carries; `event` stays OUT of the signal path and is typed only to colour a socket. */
export type WebSignal = "audio" | "midi" | "video" | "event";

/** The module type folders as VALUES, with the type derived from them so the two cannot drift — docs/graph.md. */
export const MODULE_CATEGORIES = [
  "io",
  "instruments",
  "audio",
  "transformers",
  "midi", // the legacy alias of transformers
  "video_effects",
  "video_transitions",
  // A GLSL pass: its own category, being the one module whose behaviour is a FILE it carries.
  "shaders",
  // A drawn primitive — a rectangle, a circle, a line of text — wired to the lane it draws on.
  "shapes",
] as const;

export type WebModuleCategory = (typeof MODULE_CATEGORIES)[number];

export interface WebChainStep {
  module: string; // a module node name
  /** The module this node USES — the header's main name, absent when the node IS one; see docs/graph.md. */
  uses?: string;
  /** Where a chain project's unnamed node sits, `chain · step n` — shown in its uuid's place, never sent back. */
  place?: string;
  /** The engine's stage this module takes — `@input-volume`, `@mix`, `@output-volume` — drawn in its card's FOOTER. */
  stage?: string[];
  category?: WebModuleCategory; // its type folder — picks the node's icon
  // What this module EMITS. Absent for a module that emits nothing (a sink) or whose category is unknown.
  emits?: WebSignal;
  enabled?: boolean; // false == bypassed
  // The chain names a module this project doesn't have: not fatal, the name draws with a `?`.
  missing?: boolean;
  /** The INPUT ports, sent only past the one every module has; `mandatory` decides how many show — docs/graph.md. */
  inputs?: { name: string; type: WebSignal; mandatory?: boolean }[];
  /** …and the OUTPUT ports, on the same terms but all shown at once, an output being offered rather than required. */
  outputs?: { name: string; type: WebSignal }[];
  /** The EVENTS this module announces, drawn as sockets NEVER mixed with the signal outputs — docs/graph.md. */
  events?: string[];
  // The files this module loads, by param name, relative to its own assets/ — the dropdown's current choice.
  assets?: Record<string, string>;
  // …and what it may choose FROM: the module's own assets/, walked, there being no shared library.
  assetChoices?: string[];
  /** Which named BASE this module is on, and what it may choose from — `bases` absent means no base control. */
  base?: string;
  bases?: string[];
  /** Which SHADER a shader node runs, and what it may choose from — the third pair of this shape; docs/graph.md. */
  shader?: string;
  shaders?: string[];
  stub?: boolean; // a plugin module that resolved to no plugin (missing on import)
  notSupported?: boolean; // plugin.type is "not_supported" — k7 can't load it; bypassed
  unknownPlugin?: boolean; // plugin.type is an UNKNOWN format (typo / unimported) — bypassed
  hasNativePluginUI?: boolean; // an external plugin with a native editor the engine can open
  /** A lane's STRIP (the internal `Mixer`): it cannot be bypassed and has no alternatives — packages/song/docs/trackMixer.md. */
  strip?: boolean;
  /** The model this module names and the machine has not got, when its `model_url` says where to fetch it — the right-click's "Download model". */
  modelDownload?: { file: string; url: string };
  /** The amp model it loads, as its file declares it — what a panel's widgets.js reads to show only that model's knobs. */
  ampModel?: { kind: "nam" | "aida-x" | "proteus"; knobs: number };
  // The UI inside this module's rectangle, already merged; undefined == neither it nor its base defines one.
  ui?: WebModuleUI;
  // Which MIDI CC plays which param, from the module FOLDER's controller.yaml, keyed by `bind` verbatim.
  cc?: Record<string, WebCc>;
  // What the module runs with; a STRING is a file-valued param, and an ABSENT one falls back to its min.
  params?: Record<string, number | string>;
  // The engine's PluginDoc id (`chain:module`) — what set-plugin-param addresses. Only for a real plugin.
  pluginId?: string;
  /** The module's other attribute SETS, sent only when there is a CHOICE — packages/song/docs/alternatives.md. */
  alternatives?: string[];
  alternative?: string;
  /** The modules it can run AS, and which it does, sent only when there is a CHOICE — packages/song/docs/engines.md. */
  engines?: string[];
  engine?: string;
  // io "in" only: whether the interface signal is audible. A module FIELD, not a param — see docs/graph.md.
  monitor?: "off" | "auto" | "on";
  /** io "in" only: the channels this input listens on, 1-based; only the NUMERIC form travels — docs/graph.md. */
  channel?: number[];
  /** io "camera" only: WHICH lens, by the LABEL a person reads — "" being whichever is default.
   *  Present is what says this step IS a camera, the way `monitor` does for a live audio input. */
  camera?: string;
  /** io "midi" only: WHICH MIDI device it records from, by its label — "" being any device.
   *  Present is what says this step IS a midi-in node, the way `camera` does for a lens. */
  device?: string;
  // Where this node's waveform widget listens, an io "in" borrowing one step downstream — see docs/graph.md.
  tap?: { id: string; side: "input" | "output" };
  // Which curve (by id) drives which param. The graph draws each as a curve node arrowing into the module.
  automations?: WebAutomation[];
  /** A RACK's loaded sounds in symbol order — the EFFECTIVE rack, `extends` folded in; see docs/graph.md. */
  rack?: WebRackSound[];
  /** Those sounds are an SFZ KIT's pads: fixed, and each played as its note through the node (docs/racks.md). */
  rackKit?: boolean;
}
/** One sound of a rack, flattened: `Rack` in @studio/song splits samples from slices, and a pad does not. */
export interface WebRackSound {
  symbol: string; // the short label — "BD", "SN", "HH"
  note: number; // the MIDI note that fires it, 0..127
  sample?: string; // a tap's library sample, `@<library>/<path>`, as written — what its picker shows
  clip?: string; // samples: the clip id this symbol plays
  source?: string; // slice: the clip id every symbol of the rack cuts from
  from?: number; // slice: window start in that source, seconds
  to?: number; // slice: window end, seconds
  mute?: boolean; // silenced — a rack tap's `mute:`, or a kit pad's `Mute <note>` param
}
// One MIDI control change: the channel a musician counts (1-16), and the control number (0-127).
export interface WebCc {
  ch: number;
  cc: number;
}
// One automation binding — a curve id driving a named param on a module.
export interface WebAutomation {
  param: string;
  curve: string; // a curve id (keys WebGraph.curves)
  /** The module whose events restart the curve — what the event cable IS; absent means this binding's own. */
  trigger?: string;
}
// A curve's shape, enough to LABEL its node — the full definition stays on disk.
export interface WebCurve {
  type: "lfo" | "custom" | "adsr" | "onoff";
  shape?: "sine" | "triangle" | "saw" | "square"; // lfo only
  /** A `custom` curve's POINTS verbatim, absent for every other type — the definition, not the bake; docs/graph.md. */
  points?: { time: string; value: number }[];
  /** …and the WHOLE definition, defaults filled: what the curve editor opens on (packages/song/docs/curves.md). */
  spec?: CurveSpec;
}

/** An oscillator's waveform. */
export type LfoShape = "sine" | "triangle" | "saw" | "square";
export type CurvePolarity = "unipolar" | "bipolar";

/** One of WHEN a curve runs — a curve runs while ANY of its conditions holds; `retrigger` restarts it the moment this one comes true (packages/song/docs/curves.md). */
export type CurveCondition =
  | { type: "start"; at: string; retrigger?: boolean }
  | { type: "end"; at: string; retrigger?: boolean }
  | { type: "between"; start: string; end: string; retrigger?: boolean }
  | { type: "event"; event: string; retrigger?: boolean };

/** Which half of its output a curve keeps: all of it, only what is above 0, or only what is below (packages/song/docs/curves.md). */
export type CurveCut = "none" | "positive" | "negative";

/** One curve, every field resolved — the model a file is read into, the bake samples, and the editor writes. */
export type CurveSpec = { conditions?: CurveCondition[]; cut?: CurveCut } & (
  | {
      type: "lfo";
      polarity: CurvePolarity;
      /** 0..1, scaling the output: the whole range at 1. */
      amplitude: number;
      shape: LfoShape;
      frequency: number; // cycles per bar (>0)
      phase: number; // 0..1 of a cycle
      /** How long it runs from its own start, a 0-based timecode ("2:0"); absent is for ever. */
      duration?: string;
    }
  | {
      type: "custom";
      polarity: CurvePolarity;
      amplitude: number;
      points: { time: string; value: number }[];
    }
  /** A boolean param's curve: points of 0 or 1, each HELD until the next — polarity and amplitude fixed, unipolar 1. */
  | {
      type: "onoff";
      polarity: CurvePolarity;
      amplitude: number;
      points: { time: string; value: number }[];
    }
  | {
      type: "adsr";
      polarity: CurvePolarity;
      amplitude: number;
      attack: number; // ms
      decay: number; // ms
      sustain: number; // ms — a hold at `level`
      release: number; // ms
      level: number; // 0..1
    }
);
/** One automation LANE as the timeline draws it, derived from the graph by `automationLanes` — docs/graph.md. */
export interface WebAutomationLane {
  track: string; // the lane it draws under — the chain's own name
  module: string; // which node in that chain owns the knob
  param: string;
  curve: string; // the curve id, which is what a later edit will address
  /** Song timecodes and 0..1 values verbatim; empty for an LFO or ADSR, whose row says only that it is bound. */
  points: { time: string; value: number }[];
}

export interface WebChain {
  from?: string; // a track id (or another chain)
  // Which of the source lane's OUTPUTS this run left by, absent unless the lane was wired on both — docs/graph.md.
  fromPort?: string;
  use: WebChainStep[]; // ordered module nodes
  enabled?: boolean; // whole-chain bypass
  out: WebOut[];
}
/** Per-module metadata off the signal path: one field, a DOC module's note text — see docs/graph.md. */
export interface WebModuleMeta {
  content?: string;
}
/** How a routing graph names a PORT: `crossfade#b`, a third separator for a third axis — docs/graph.md. */
export const PORT_SEP = "#";

/** A ref split into node and port; only the LAST `#` is the port, so the others are left alone. */
export function splitPort(ref: string): { node: string; port?: string } {
  const cut = ref.lastIndexOf(PORT_SEP);
  if (cut <= 0) return { node: ref }; // no separator, or a ref that IS one — not a port
  const port = ref.slice(cut + 1);
  return port ? { node: ref.slice(0, cut), port } : { node: ref };
}

/** …and back; a port-less ref is the node's own name unchanged, which is the overwhelming case. */
export const portRef = (node: string, port?: string): string =>
  port ? `${node}${PORT_SEP}${port}` : node;

/** The two outputs every LANE offers, audio FIRST because the order is load-bearing — see docs/graph.md. */
export const TRACK_OUT_AUDIO = "audio";
export const TRACK_OUT_MIDI = "midi";
export const TRACK_OUTPUTS = [
  { name: TRACK_OUT_AUDIO, type: "audio" },
  { name: TRACK_OUT_MIDI, type: "midi" },
] as const satisfies readonly { name: string; type: WebSignal }[];

/** One clip as the GRAPH needs it — a trim of the compiled `Placement`, keeping `kind`; see docs/graph.md. */
export interface WebTrackClip {
  ref: string;
  /** Beats from the start of the song. Sorted on, so the list reads in playing order. */
  start: number;
  /** `start` as the song SPELLS it, formatted where the time signature is — see docs/graph.md. */
  tc: string;
  /** How long it runs in beats, from the COMPILED project; absent when the project does not compile. */
  len?: number;
  kind: "audio" | "midi" | "missing";
}

/** One PLUG on an assembly's box: a port, plus the member node whose own port it stands for. */
export interface WebPlug {
  name: string;
  type: WebSignal;
  node: string;
  port?: string;
  mandatory?: boolean;
}

/** One ASSEMBLY as the browser receives it — a template's box over nodes this project holds.
 *
 * `WebNodeAssembly` rather than `WebAssembly`, which is a JS global: shadowing it inside a
 * renderer that may one day touch wasm is a name nobody would suspect. See
 * packages/song/docs/assemblies.md. */
export interface WebNodeAssembly {
  uses: string; // the template ref (`@k7-core/turntable`)
  label: string; // the template's `label:`, else the instance's own name
  members: string[]; // this project's node names, in the template's declaration order
  inputs?: WebPlug[];
  outputs?: WebPlug[];
  /** A PROMOTED param: the box's own knob, and the member param it writes. */
  params?: Record<string, { node: string; param: string; pluginId?: string }>;
  // The template resolved to nothing: the box draws from its members alone, with no plugs.
  missing?: boolean;
}

export interface WebGraph {
  chains: Record<string, WebChain>;
  tracks: string[]; // track ids, for resolving `from`
  // Where somebody PINNED a node — graph.yaml's `positions:` verbatim, and the layout places only the rest.
  positions?: Record<string, { x: number; y: number }>;
  // Video track ids. A video lane is a chain source like any other, and one no chain mentions is still drawn.
  videoTracks?: string[];
  // What each track EMITS into a chain's first module, by track id; a track absent here is treated as audio.
  trackSignals?: Record<string, WebSignal>;
  // Per-track display colour by track id — the timeline's colour. Absent when the track authors none.
  trackColors?: Record<string, string>;
  /** A chain project's STACKS — each subchain run in place, its nodes in order; absent outside a chain project. */
  stacks?: string[][];
  /** Which NODE is each track's fader — the `Mixer` at the end of its chain, so that card can wear the lane's face. */
  trackMixers?: Record<string, string>;
  // What each track HOLDS, in playing order; absent for a group or a strudel lane, which hold no placements.
  trackClips?: Record<string, WebTrackClip[]>;
  /** A lane's other attribute SETS, in its own map because a lane's node is built from the track side — docs/graph.md. */
  trackAlternatives?: Record<
    string,
    { alternatives: string[]; alternative: string }
  >;
  /** What is BAKED, by node name: `"at"` the point, `"inside"` what it contains — packages/song/docs/freeze.md. */
  // A rack node's taps routed to subchains: the tap, and the first node of the run it feeds (packages/song/docs/racks.md).
  tapFeeds?: { node: string; tap: string; to: string }[];
  frozen?: Record<string, "at" | "inside">;
  /**
   * What an AUTOMATIC freeze bakes, node name → the VST module the render was taken at
   * (packages/song/docs/autoFreeze.md). Apart from `frozen` because it acts the other way: its
   * controls are not refused — touching one thaws that point, and the edit plays live.
   */
  autoFrozen?: Record<string, string>;
  // The note text of every doc module, optional because dagre's layout-only subgraphs carry geometry alone.
  modules?: Record<string, WebModuleMeta>;
  // Every curve a module binds, keyed by id — its shape, for the node's label. An unreferenced curve draws nothing.
  curves?: Record<string, WebCurve>;
  /** The boxes, keyed by name — a DRAWING fact, so no chain and no step reads one; docs/assemblies.md. */
  assemblies?: Record<string, WebNodeAssembly>;
  warnings: string[];
}

/** Every automation lane by track — the join done ONCE, since two surfaces would disagree; docs/graph.md. */
export function automationLanes(
  graph: Pick<WebGraph, "chains" | "curves">,
): Record<string, WebAutomationLane[]> {
  const out: Record<string, WebAutomationLane[]> = {};
  for (const c of Object.values(graph.chains ?? {})) {
    const track = c.from;
    if (!track) continue;
    for (const s of c.use)
      for (const a of s.automations ?? []) {
        const curve = graph.curves?.[a.curve];
        (out[track] ??= []).push({
          track,
          module: s.module,
          param: a.param,
          curve: a.curve,
          points: curve?.points ?? [],
        });
      }
  }
  return out;
}
