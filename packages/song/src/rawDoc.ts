// rawDoc.ts — the RAW shapes the YAML loader hands the assemblers. "Raw" means as-authored: the file's own
// field names, values as the Zod schemas let them through, and `unknown` wherever the loader can't promise —
// the assemblers coerce. This is the typed seam that used to be `any` end to end, so a mistyped field name in
// an assembler is now a compile error rather than an `undefined` that flows to the engine.

import type { ModuleKind } from "./moduleTypes";

/** One entry of a lane's `events:` list — a placement of a clip/sequence by ref. */
export interface RawPlacement {
  ref?: string;
  start?: string | number;
  fadeIn?: string | number;
  fadeOut?: string | number;
  loop?: number; // how many times the material's window is played (see PlacementSchema)
  // The EVENT's own window into the material — intersected with the material's, most
  // restrictive edge wins (see PlacementSchema). Same spellings as the material's pair.
  from?: unknown;
  to?: unknown;
  disabled?: boolean; // silenced, but still placed — the event-level `mute`
  // Whether this event plays the material's stretch map. Absent ⇒ yes; `false` is the only value
  // that says anything, because the default is the other way round (see PlacementSchema).
  warp?: boolean;
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
  // The window into the source. `unknown` because the SPELLING is the unit: a bare number is
  // seconds into the file, a timecode is musical — see AudioClipSchema.
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
  events?: RawVideoPlacement[]; // "video" tracks
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
  io?: string; // io modules: "out" | "in" | "video_out" | "file" (see moduleTypes.IO_SOURCES)
  type?: string; // instrument type: "plugin" (implied) | "rack"
  // Numbers, except the file-valued ones (moduleTypes.FILE_PARAMS) — see moduleSchema.
  params?: Record<string, number | string>;
  rack?: RawRack;
  // Only usable on material already on disk — it needs the WHOLE input before it can produce
  // any of it. Inherited like `plugin`, so a use of a cold module is cold. See docs/coldModules.md.
  cold?: boolean;
  ui?: unknown; // the widget grid — normalized downstream (effectiveUI)
  // The module's MIDI map, from the `controller.yaml` in its folder (controller.ts). Stamped on
  // beside `ui` and by the same rule, so every node of the module carries it.
  cc?: unknown;
  channel?: unknown; // io "in" only
  // io "file" only — the audio it reads, project-relative. NOT `file`: the loader writes the
  // module's folder name to that one, and would overwrite an authored value. See moduleSchema.
  source?: unknown;
  track?: unknown; // io "in" only
  monitor?: unknown; // io "in" only
  gain?: unknown; // io "in" only — interface trim in dB
  // A NOTE's text, on a doc module. `docs`/`todos` were here and are gone — see moduleSchema.
  content?: unknown;
  automations?: unknown;
  // The module's other attribute SETS, and which is on. Its own fields ARE the first, so these
  // are the ones after it — see docs/alternatives.md. They survive resolution deliberately: what
  // a surface lists is what the file says, not what it was collapsed to.
  alternatives?: unknown;
  alternative?: unknown;
  // FROZEN at this module: the render standing in for everything upstream of it, itself
  // included, project-relative. See docs/freeze.md.
  frozen?: unknown;
  // -- lanes only (a track module; see docs/trackModules.md) ---------------------
  events?: unknown; // the placements on this lane — where its material goes, and how many times
  takes?: unknown; // the arrangements set aside, each another list of placements (docs/takes.md)
  color?: unknown; // the lane's colour, and its icon's in the timeline
  disabled?: unknown; // excluded from the render entirely, chains and all
  tracks?: unknown; // a GROUP lane's member names
  strudel?: unknown; // a GENERATED lane's pattern file (algo/<name>.strudel)
  // -- added by the loader ------------------------------------------------------
  kind: ModuleKind; // from the type folder (MODULE_TYPES)
  // The module's ports: its OWN when it declares them, else its type folder's defaults. Both
  // resolved by the loader, so nothing downstream has to know which of the two it got.
  // See docs/ports.md.
  inputs: {
    name: string;
    type: "audio" | "midi" | "video";
    mandatory?: boolean;
  }[];
  outputs?: { name: string; type: "audio" | "midi" | "video" }[];
  // A lane whose clips are STREAMED rather than written down. Stamped on the two strudel built-ins
  // and inherited by every node of them, which is the whole mechanism — it is deliberately NOT
  // in moduleSchema, so it cannot be authored and cannot disagree with what the lane extends.
  generated?: boolean;
  preset?: string; // resolved .vstpreset path, if any
  nam?: string; // a file-valued param resolved against the module's assets/ (undefined when unresolvable)…
  onnx?: string; // …the same, for the neural model an offline module runs (see docs/moduleAssets.md)
  jsdsp?: string; // resolved ABSOLUTE path to the module's JS/TS DSP source, when it declares one
  faust?: string; // …and to its Faust source, the other language a module's DSP can be written in
  assets?: Record<string, string>; // …and the name it was authored with
  // The ABSOLUTE folder this module's files live in, whichever library that is. Written by the
  // loader on every module it decorates, and read by the ancestry fold: a module may name a file
  // its PARENT carries, so resolving one needs the folders of the whole chain. See assetPath.ts.
  folderAbs?: string;
  // -- local modules only (loadModules) -----------------------------------------
  name?: string; // the chain `use` key ("<name>" or "<name>:<node>")
  category?: string; // the type folder (io|instruments|audio|transformers|…)
  file?: string; // the module's folder name
  node?: string; // undefined for the generic
  // The folder this module's own files live in, PROJECT-RELATIVE. Set for a flat node,
  // whose location is `nodes/` and therefore cannot be rebuilt out of category + file.
  home?: string;
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
  // The dialect a folder used to declare, when there were two. A root sibling, accepted and
  // ignored like `project_type` below — `deadProjectFields` names the line to delete.
  type?: string;
  // Accepted and ignored — see projectSchema.ts. Typed as `string` because nothing narrows it:
  // no reader is left, and the key only survives so a folder written before the notion went away
  // still parses against a `.strict()` schema.
  project_type?: string;
  trackOrder?: string[];
  // The soloed lanes — solo as project state, resolved by the engine (see projectSchema.ts).
  soloed?: string[];
  markers?: unknown;
  chains?: unknown;
}
