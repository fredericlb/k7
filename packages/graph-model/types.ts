// types.ts — the chains routing graph as the browser receives it (mirrors the essentials
// of the song compiler's GraphDoc). Types only, so the whole module is erased at runtime.
// Lives apart from @studio/web-protocol because three apps draw chains — lanes, mediatek's
// module builder, platines — and only lanes wants auth, workspaces and the registry.

export interface WebOut {
  to: string; // a chain name or an io sink (e.g. "OUT")
  gain: number; // 0..1 share (1 == whole signal)
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
    | "dropdown";
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
  // dropdown only: a discrete param's named settings with the value that selects each (not derivable from index).
  options?: { label: string; value: number }[];
  // dropdown only: choices from a library folder ("ir"). Picking one writes the module's own field, not a param.
  library?: string;
}
export interface WebModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, WebWidget>;
}
// What a cable carries, derived from the module's TYPE FOLDER (see loader.ts MODULE_TYPES). Colours the cable.
export type WebSignal = "audio" | "midi" | "video";

// A module's type folder. The graph draws an icon per kind, which `emits` can't stand in for.
export type WebModuleCategory =
  | "io"
  | "instruments"
  | "audio"
  | "transformers"
  | "midi" // the legacy alias of transformers
  | "video_effects"
  | "video_transitions";

export interface WebChainStep {
  module: string; // a module instance name
  category?: WebModuleCategory; // its type folder — picks the node's icon
  // What this module EMITS. Absent for a module that emits nothing (a sink) or whose category is unknown.
  emits?: WebSignal;
  enabled?: boolean; // false == bypassed
  // The chain names a module this project doesn't have. Not fatal: the step compiles to nothing and the graph
  // draws the name with a `?`. Bypass is the one thing it takes.
  missing?: boolean;
  // Library files this module loads, by asset kind ("ir", "nam"), library-relative — the dropdown's current choice.
  assets?: Record<string, string>;
  stub?: boolean; // a plugin module that resolved to no plugin (missing on import)
  notSupported?: boolean; // plugin.type is "not_supported" — lanes can't load it; bypassed
  unknownPlugin?: boolean; // plugin.type is an UNKNOWN format (typo / unimported) — bypassed
  hasNativePluginUI?: boolean; // an external plugin with a native editor the engine can open
  // The UI drawn inside this module's rectangle, already merged (extended module's, overridden per widget id by
  // this one's). Undefined == neither defines one.
  ui?: WebModuleUI;
  // What the module actually runs with (defaults + overrides). A bound param may be ABSENT — the plugin's own
  // default is known only to the engine, so a widget with no value falls back to its authored min.
  params?: Record<string, number>;
  // The engine's PluginDoc id (`chain:module`) — what set-plugin-param addresses. Only for a real plugin.
  pluginId?: string;
  // io "in" only: whether the interface signal is audible. A module FIELD, not a param — which is why a widget
  // bound to it needs a target of its own (see widgetTarget's "module" kind).
  monitor?: "off" | "auto" | "on";
  // Where this node's waveform widget listens. Normally its own plugin's output; an io "in" module has no
  // plugin at all, so it borrows the INPUT side of the first plugin on the lane it feeds — the same signal,
  // one step downstream. Absent ⇒ the widget falls back to `pluginId` + the widget's own `source`.
  tap?: { id: string; side: "input" | "output" };
  // Which curve (by id) drives which param. The graph draws each as a curve node arrowing into the module.
  automations?: WebAutomation[];
}
// One automation binding — a curve id driving a named param on a module.
export interface WebAutomation {
  param: string;
  curve: string; // a curve id (keys WebGraph.curves)
}
// A curve's shape, enough to LABEL its node — the full definition stays on disk.
export interface WebCurve {
  type: "lfo" | "custom";
  shape?: "sine" | "triangle" | "saw" | "square"; // lfo only
}
export interface WebChain {
  from?: string; // a track id (or another chain)
  use: WebChainStep[]; // ordered module instances
  enabled?: boolean; // whole-chain bypass
  out: WebOut[];
}
// Per-module metadata off the signal path (notes, to-dos), keyed by the name a chain step's `module` references.
export interface WebModuleMeta {
  docs?: string;
  todos?: string[];
}
export interface WebGraph {
  // The shared asset library, library-relative — what a module UI's library dropdown offers. Carried here because
  // that is what the node renderer has in hand; the same list is in Hints.
  libraryFiles?: string[];
  chains: Record<string, WebChain>;
  tracks: string[]; // track ids, for resolving `from`
  // Video track ids. A video lane is a chain source like any other, and one no chain mentions is still drawn.
  videoTracks?: string[];
  // What each track EMITS into a chain's first module, by track id; a track absent here is treated as audio.
  trackSignals?: Record<string, WebSignal>;
  // Per-track display colour by track id — the timeline's colour. Absent when the track authors none.
  trackColors?: Record<string, string>;
  // The ids of tracks currently FROZEN: playing a render of themselves. The graph marks their lane and every
  // module downstream of it, because those modules are in the render and no longer run — and a node you can still
  // click a knob on had better not be one the engine stopped listening to.
  frozenTracks?: string[];
  // Every module's notes/checklist by name — always populated by the backend, so the Docs panel is complete.
  // Optional because the layout-only subgraphs feeding dagre carry geometry, not docs.
  modules?: Record<string, WebModuleMeta>;
  // Every curve a module binds, keyed by id — its shape, for the node's label. An unreferenced curve draws nothing.
  curves?: Record<string, WebCurve>;
  warnings: string[];
}
