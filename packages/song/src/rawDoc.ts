// rawDoc.ts — the RAW shapes the YAML loader hands the assemblers. "Raw" means as-authored: the file's own
// field names, values as the Zod schemas let them through, and `unknown` wherever the loader can't promise —
// the assemblers coerce. This is the typed seam: a mistyped field name in an assembler is a compile error
// rather than an `undefined` that flows to the engine.

import type { ModuleKind } from "@studio/song-schema/moduleTypes";

/** One entry of a lane's `events:` list — a placement of a clip/sequence by ref. */
export interface RawPlacement {
  ref?: string;
  start?: string | number;
  fadeIn?: string | number;
  fadeOut?: string | number;
  loop?: number; // how many times the material's window is played (see PlacementSchema)
  // The EVENT's own window, intersected with the material's — most restrictive edge wins (PlacementSchema).
  from?: unknown;
  to?: unknown;
  disabled?: boolean; // silenced, but still placed — the event-level `mute`
  // Whether this event plays the material's stretch map; absent means yes, so only `false` says anything.
  warp?: boolean;
  // Other performances of the event and which plays where, in song positions (docs/takes.md).
  takes?: { ref?: string; start?: string }[];
  comp?: { take?: string; from?: string; to?: string }[];
  crossfades?: { at?: string; length?: string }[];
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
  events?: RawPlacement[];
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
  // The window into the source; `unknown` because the SPELLING is the unit (see AudioClipSchema).
  from?: unknown;
  to?: unknown;
  // `disable` switches the map off without deleting it (AudioClipSchema's WarpSchema).
  warp?: { algorithm?: unknown; markers?: unknown; disable?: unknown };
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
  // A number, or `{ over, with }` naming the module that draws it (song-video/docs/transitions.md).
  fade_in?: unknown;
  fade_out?: unknown;
}

/** A video track file's struct (video_tracks/<id>.yaml). */
export interface RawVideoTrack {
  name?: unknown;
  color?: unknown;
  mute?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  events?: RawVideoPlacement[]; // the shots this lane places
  [key: string]: unknown;
}

/** One rack symbol as authored ({note, clip} or {note, from, to}). */
export interface RawRackSound {
  note?: unknown;
  sample?: unknown; // `@<library>/<path>` under a library's samples/ — docs/libraryFiles.md
  clip?: unknown;
  from?: unknown;
  to?: unknown;
}

/** A rack as authored (`rack_type`) or already normalized (`rackType`) — effectiveRack merges both. */
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

/** The authored module struct plus what the LOADER adds; an INHERITED one has no local identity. */
export interface LoadedModule {
  // -- a chain project's node (docs/chainFiles.md) -------------------------------
  /** The chain the node is an item of. */
  chain?: string;
  /** Its `id:` — a lane is known by its lane name, everything else by this. */
  nodeId?: string;
  /** Where its plugin state is saved, project-relative: `vstpresets/<file>`. */
  presetRel?: string;
  // -- authored -----------------------------------------------------------------
  extends?: string;
  plugin?: RawPlugin;
  io?: string; // io modules: "out" | "in" | "video_out" | "file" (see moduleTypes.IO_SOURCES)
  type?: string; // instrument type: "plugin" (implied) | "rack"
  // Numbers, except the file-valued ones (moduleTypes.FILE_PARAMS) — see moduleSchema.
  params?: Record<string, number | string>;
  rack?: RawRack;
  // An SFZ kit's pads, name → note: drawn like a rack's taps, played through the kit (docs/racks.md).
  kit?: Record<string, number>;
  // Needs the WHOLE input before producing any of it, and is inherited — see docs/coldModules.md.
  cold?: boolean;
  // The engine's dry/wet around the effect, 0..1, inherited like any field — engine/st0-engine/docs/mix.md.
  mix?: number;
  // …and its levels on the same stage, in dB.
  input_volume?: number;
  output_volume?: number;
  // Where the model a file-valued param names can be downloaded from — see docs/moduleAssets.md.
  model_url?: string;
  // shaders only — which folder under the module's `shaders/` this node runs (song-video's docs/shaders.md).
  shader?: unknown;
  // shapes only — which primitive it draws, and the family a `text` one is set in (song-video's docs/shapes.md).
  shape?: unknown;
  font?: unknown;
  ui?: unknown; // the widget grid — normalized downstream (effectiveUI)
  // The module's MIDI map from its folder's `controller.yaml`, stamped on beside `ui` and by the same rule.
  cc?: unknown;
  channel?: unknown; // io "in" only
  camera?: unknown; // io "camera" only — the LABEL, see packages/song/docs/camera.md
  device?: unknown; // io "midi" only — the MIDI device's LABEL, see packages/song/docs/midiIn.md
  frame?: unknown; // …and its rectangle in the viewport, [x, y, w, h]
  // io "file" only — the audio it reads, project-relative; NOT `file`, which the loader owns (moduleSchema).
  source?: unknown;
  track?: unknown; // io "in" only
  monitor?: unknown; // io "in" only
  gain?: unknown; // io "in" only — interface trim in dB
  // A NOTE's text, on a doc module — no `docs`/`todos` field exists, see moduleSchema.
  content?: unknown;
  automations?: unknown;
  // The attribute SETS after the module's own fields, surviving resolution — see docs/alternatives.md.
  alternatives?: unknown;
  alternative?: unknown;
  // FROZEN here: the render standing in for everything upstream, itself included — see docs/freeze.md.
  frozen?: unknown;
  // Which of its `engines/` it runs, and the values set per engine — see docs/engines.md.
  engine?: unknown;
  engines?: unknown;
  // -- lanes only (a track module; see docs/trackModules.md) ---------------------
  events?: unknown; // the placements on this lane — where its material goes, and how many times
  color?: unknown; // the lane's colour, and its icon's in the timeline
  disabled?: unknown; // excluded from the render entirely, chains and all
  tracks?: unknown; // a GROUP lane's member names
  strudel?: unknown; // a GENERATED lane's pattern file (algo/<name>.strudel)
  // -- added by the loader ------------------------------------------------------
  kind: ModuleKind; // from the type folder (MODULE_TYPES)
  // The module's ports, its own or its type folder's, resolved by the loader — see docs/ports.md.
  inputs: {
    name: string;
    type: "audio" | "midi" | "video";
    mandatory?: boolean;
  }[];
  outputs?: { name: string; type: "audio" | "midi" | "video" }[];
  // A lane whose clips are STREAMED: stamped on the strudel built-ins and inherited, never authored.
  generated?: boolean;
  preset?: string; // resolved .vstpreset path, if any
  model?: string; // the amp model, a file-valued param resolved against the module's assets/ (undefined when unresolvable)…
  onnx?: string; // …the same, for the neural model an offline module runs (see docs/moduleAssets.md)
  ir?: string; // a cabinet IR, resolved against the account libraries' `irs/` (docs/libraryFiles.md)
  jsdsp?: string; // resolved ABSOLUTE path to the module's JS/TS DSP source, when it declares one
  faust?: string; // …and to its Faust source, the other language a module's DSP can be written in
  assets?: Record<string, string>; // …and the name it was authored with
  // The ABSOLUTE folder this module's files live in — the ancestry fold needs the whole chain's (assetPath.ts).
  folderAbs?: string;
  // Every engine its folder holds, name → ref; and, on an engine itself, the module it belongs to (docs/engines.md).
  engineRefs?: Record<string, string>;
  engineOf?: string;
  // -- local modules only (loadModules) -----------------------------------------
  name?: string; // the chain `use` key ("<name>" or "<name>:<node>")
  category?: string; // the type folder (io|instruments|audio|transformers|…)
  file?: string; // the module's folder name
  node?: string; // undefined for the generic
  // The PROJECT-RELATIVE folder, set for a flat node whose `nodes/` location category + file cannot rebuild.
  home?: string;
}

/** One note of an assembled clip (long-form keys; folder.ts expands {t,d,k,v}). */
export interface AssembledNote {
  time?: unknown;
  duration?: unknown;
  key?: unknown;
  vel?: unknown;
  channel?: unknown;
  camera?: unknown;
  device?: unknown;
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
  outputChannels?: unknown;
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

/** The plain { project, tracks[] } mapDoc consumes — from a single-file song or folder.ts's assembler. */
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
    tags?: string[];
    [key: string]: unknown;
  };
  // A dialect a folder may still declare, accepted and ignored — `deadProjectFields` names the line to delete.
  type?: string;
  // Accepted and ignored, so a folder still carrying it parses (projectSchema.ts).
  project_type?: string;
  trackOrder?: string[];
  // The soloed lanes — solo as project state, resolved by the engine (see projectSchema.ts).
  soloed?: string[];
  // …and the highlighted ones, heard 10 dB up (highlight.ts).
  highlighted?: string[];
  markers?: unknown;
  chains?: unknown;
}
