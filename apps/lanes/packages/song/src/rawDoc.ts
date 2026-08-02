// rawDoc.ts — the RAW shapes the YAML loader hands the assemblers. "Raw" means as-authored: the file's own
// field names, values as the Zod schemas let them through, and `unknown` wherever the loader can't promise —
// the assemblers coerce. This is the typed seam that used to be `any` end to end, so a mistyped field name in
// an assembler is now a compile error rather than an `undefined` that flows to the engine.

/** One entry of a track's `clips:` list — a placement of a clip/sequence by ref. */
export interface RawPlacement {
  ref?: string;
  start?: string | number;
  fadeIn?: string | number;
  fadeOut?: string | number;
  loop?: number; // how many times the material's window is played (see PlacementSchema)
  disabled?: boolean; // silenced, but still placed — the event-level `mute`
}

/** A track file's struct (tracks/<id>.yaml), any of the three kinds. */
export interface RawTrack {
  type?: string; // "single" (implied) | "group" | "strudel"
  contentType?: string; // "audio" | "sequences"
  name?: string;
  color?: unknown;
  volume?: number;
  pan?: number;
  mute?: unknown;
  solo?: unknown;
  disabled?: unknown;
  clips?: RawPlacement[];
  tracks?: unknown[]; // group only: member ids
  strudel?: unknown; // strudel only: the pattern file
  frozen?: unknown; // single only: the render standing in for its material + modules (see frozenRender)
  video_source?: unknown; // audio-from-video link (see nodeProject)
  docs?: unknown;
  todos?: unknown;
}

/** A clip file's struct (clips/<id>.yaml) — audio or video, told apart by extension. */
export interface RawClip {
  source?: string;
  name?: unknown;
  gain?: unknown;
  // The window into the source, in seconds — see AudioClipSchema for why these are not timecodes.
  from?: unknown;
  to?: unknown;
  warp?: { algorithm?: unknown; markers?: unknown };
  [key: string]: unknown;
}

/** A sequence file's struct (sequences/<id>.yaml). */
export interface RawSequence {
  name?: unknown;
  notes?: unknown;
  // The window into the notes, as timecode POSITIONS — the MIDI half of a clip's from/to.
  from?: unknown;
  to?: unknown;
  use_rack?: unknown;
  [key: string]: unknown;
}

/** One video placement (seconds, not timecodes — picture cuts against the clock). */
export interface RawVideoPlacement {
  ref?: unknown;
  start?: unknown;
  length?: unknown;
  source_from?: unknown;
}

/** A video track file's struct (video_tracks/<id>.yaml). */
export interface RawVideoTrack {
  name?: unknown;
  color?: unknown;
  kind?: unknown; // "video" (implied) | "shape"
  mute?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  clips?: RawVideoPlacement[]; // "video" tracks
  shapes?: unknown[]; // "shape" tracks
  [key: string]: unknown;
}

/** One rack symbol as authored ({note, clip} or {note, from, to}). */
export interface RawRackSound {
  note?: unknown;
  clip?: unknown;
  from?: unknown;
  to?: unknown;
}

/**
 * A rack as authored (`rack_type`) — or already normalized (`rackType`), since
 * effectiveRack merges the raw per-file shape with the typed graph model.
 */
export interface RawRack {
  rack_type?: unknown;
  rackType?: unknown;
  source?: unknown;
  symbols?: Record<string, RawRackSound | undefined>;
}

/** A module's plugin declaration ({type, name} — the shape the engine matches on). */
export interface RawPlugin {
  type?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

/**
 * A module as `loadModules` / `readModuleTree` return it: the authored struct
 * (Zod-validated by moduleSchema) plus the fields the LOADER adds — kind/inputs from
 * the type folder, resolved preset/asset paths, and (for a local module) its identity.
 *
 * `name`/`category`/`file` are optional because an INHERITED module (`modules_from`,
 * read by readModuleTree) is keyed by ref and carries no local identity.
 */
export interface LoadedModule {
  // -- authored -----------------------------------------------------------------
  extends?: string;
  plugin?: RawPlugin;
  io?: string; // io modules: "out" | "in" | "video_out"
  type?: string; // instrument type: "plugin" (implied) | "rack"
  params?: Record<string, number>;
  rack?: RawRack;
  ui?: unknown; // the widget grid — normalized downstream (effectiveUI)
  channel?: unknown; // io "in" only
  track?: unknown; // io "in" only
  monitor?: unknown; // io "in" only
  gain?: unknown; // io "in" only — interface trim in dB
  docs?: unknown;
  todos?: unknown;
  automations?: unknown;
  // -- added by the loader ------------------------------------------------------
  kind: "io" | "plugin"; // from the type folder (MODULE_TYPES)
  inputs: { name: string; type: "audio" | "midi" | "video" }[];
  preset?: string; // resolved .vstpreset path, if any
  ir?: string; // resolved library asset paths (undefined when unresolvable)…
  nam?: string;
  jsdsp?: string; // resolved ABSOLUTE path to the module's JS/TS DSP source, when it declares one
  assets?: Record<string, string>; // …and the names they were authored with
  // -- local modules only (loadModules) -----------------------------------------
  name?: string; // the chain `use` key ("<name>" or "<name>:<instance>")
  category?: string; // the type folder (io|instruments|audio|transformers|…)
  file?: string; // the module's folder name
  instance?: string; // undefined for the generic
}

/** One note of an assembled clip (long-form keys; folder.ts expands {t,d,k,v}). */
export interface AssembledNote {
  time?: unknown;
  duration?: unknown;
  key?: unknown;
  vel?: unknown;
  channel?: unknown;
  rel?: unknown;
}

/** One clip of an assembled doc — audio (source) or MIDI (notes), told apart there. */
export interface AssembledClip {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  source?: unknown;
  start?: unknown;
  length?: unknown;
  offset?: unknown;
  fadeIn?: unknown;
  fadeOut?: unknown;
  loopStart?: unknown;
  loopEnd?: unknown;
  notes?: AssembledNote[];
  [key: string]: unknown;
}

/** One track of an assembled doc (the flat single-file shape). */
export interface AssembledTrack {
  id?: unknown;
  name?: unknown;
  role?: unknown;
  contentType?: unknown;
  group?: unknown;
  inputChannels?: unknown;
  monitor?: unknown;
  inputGain?: unknown;
  color?: unknown;
  volume?: unknown;
  pan?: unknown;
  mute?: unknown;
  solo?: unknown;
  disabled?: unknown;
  clips?: AssembledClip[];
  plugins?: {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    path?: unknown;
    presetSave?: unknown;
    role?: unknown;
    enabled?: unknown;
    params?: unknown;
  }[];
  sends?: { to?: unknown; level?: unknown; enabled?: unknown }[];
  automation?: { param?: unknown; points?: unknown }[];
}

/**
 * The plain { project, tracks[] } doc project.ts's mapDoc consumes — produced by a
 * single-file YAML song or by folder.ts's assembler.
 */
export interface AssembledDoc {
  project?: {
    uuid?: unknown;
    name?: unknown;
    tempo?: unknown;
    sampleRate?: unknown;
    timeSignature?: unknown;
    [key: string]: unknown;
  };
  tracks?: AssembledTrack[];
  markers?: unknown;
  settings?: unknown;
}

/** The project root file (project.yaml), post-Zod. */
export interface RawProjectRoot {
  project?: {
    name?: string;
    tempo?: number;
    sampleRate?: number;
    timeSignature?: string;
    modules_from?: string[];
    libraries_from?: string[];
    [key: string]: unknown;
  };
  trackOrder?: string[];
  markers?: unknown;
  chains?: unknown;
}
