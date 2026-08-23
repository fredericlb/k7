// types.ts — the chains routing graph as the browser receives it (mirrors the essentials
// of the song compiler's GraphDoc). Almost all types, plus the handful of values both sides
// must agree on BY VALUE — the port separator and the category list. Lives apart from
// @studio/web-protocol because three apps draw chains — st0, pl8's module builder, m9 — and
// only st0 wants auth, workspaces and the registry.

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
    | "tabs"
    | "waveform"
    | "dropdown"
    // Picks a FILE the module carries for the file-valued param it binds — see filePicker.md.
    | "filepicker";
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  text?: string; // label only
  bind?: string; // everything but label/tabs/waveform: the param it reads/writes
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  pages?: Record<string, Record<string, WebWidget>>; // tabs only: named pages of sub-widgets
  source?: "input" | "output"; // waveform only: which audio tap to display
  // dropdown only: a discrete param's named settings, `arg` differing from the label — see docs/graph.md.
  options?: { label: string; value: number; arg?: string }[];
  // dropdown only, HISTORICAL: the older spelling of a filepicker, still read as one — docs/graph.md.
  library?: string;
}
export interface WebModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, WebWidget>;
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
] as const;

export type WebModuleCategory = (typeof MODULE_CATEGORIES)[number];

export interface WebChainStep {
  module: string; // a module node name
  /** The module this node USES — the header's main name, absent when the node IS one; see docs/graph.md. */
  uses?: string;
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
  notSupported?: boolean; // plugin.type is "not_supported" — st0 can't load it; bypassed
  unknownPlugin?: boolean; // plugin.type is an UNKNOWN format (typo / unimported) — bypassed
  hasNativePluginUI?: boolean; // an external plugin with a native editor the engine can open
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
  // io "in" only: whether the interface signal is audible. A module FIELD, not a param — see docs/graph.md.
  monitor?: "off" | "auto" | "on";
  /** io "in" only: the channels this input listens on, 1-based; only the NUMERIC form travels — docs/graph.md. */
  channel?: number[];
  // Where this node's waveform widget listens, an io "in" borrowing one step downstream — see docs/graph.md.
  tap?: { id: string; side: "input" | "output" };
  // Which curve (by id) drives which param. The graph draws each as a curve node arrowing into the module.
  automations?: WebAutomation[];
  /** A RACK's loaded sounds in symbol order — the EFFECTIVE rack, `extends` folded in; see docs/graph.md. */
  rack?: WebRackSound[];
}
/** One sound of a rack, flattened: `Rack` in @studio/song splits samples from slices, and a pad does not. */
export interface WebRackSound {
  symbol: string; // the short label — "BD", "SN", "HH"
  note: number; // the MIDI note that fires it, 0..127
  clip?: string; // samples: the clip id this symbol plays
  source?: string; // slice: the clip id every symbol of the rack cuts from
  from?: number; // slice: window start in that source, seconds
  to?: number; // slice: window end, seconds
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
  type: "lfo" | "custom" | "adsr";
  shape?: "sine" | "triangle" | "saw" | "square"; // lfo only
  /** A `custom` curve's POINTS verbatim, absent for every other type — the definition, not the bake; docs/graph.md. */
  points?: { time: string; value: number }[];
}
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
  // What each track HOLDS, in playing order; absent for a group or a strudel lane, which hold no placements.
  trackClips?: Record<string, WebTrackClip[]>;
  /** A lane's other attribute SETS, in its own map because a lane's node is built from the track side — docs/graph.md. */
  trackAlternatives?: Record<
    string,
    { alternatives: string[]; alternative: string }
  >;
  /** What is BAKED, by node name: `"at"` the point, `"inside"` what it contains — packages/song/docs/freeze.md. */
  frozen?: Record<string, "at" | "inside">;
  // The note text of every doc module, optional because dagre's layout-only subgraphs carry geometry alone.
  modules?: Record<string, WebModuleMeta>;
  // Every curve a module binds, keyed by id — its shape, for the node's label. An unreferenced curve draws nothing.
  curves?: Record<string, WebCurve>;
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
