// moduleTypes.ts — the module vocabulary, with no filesystem and no imports: the type
// folders and what each one means, plus how a module is NAMED (node keys, refs, the
// slug a plugin earns).
//
// A leaf on purpose. These tables are the one thing everything about a module derives
// from — `kind`, `inputs`, `emits`, the ref a `ui.yaml` panel answers to — so knowing what
// `audio/` means costs no import of a loader that reads files, and the engine catalogue
// (which knows about plugins and nothing about folders) can reach them without a cycle.

/** The io roles the signal comes FROM; everything else under `io/` is a sink by ELIMINATION — see docs/moduleTypes.md. */
export const IO_SOURCES = ["in", "file", "camera", "midi"] as const;
export type IoSource = (typeof IO_SOURCES)[number];
export const isIoSource = (io: unknown): io is IoSource =>
  (IO_SOURCES as readonly unknown[]).includes(io);

/** The two BUILT-IN audio outputs: `MIX` is where the mixer sums, `OUT` is the interface — see docs/moduleTypes.md. */
export const MIX_NODE = "MIX";
export const OUT_NODE = "OUT";

/** The same two for PICTURE, on a project that declares a viewport — and added automatically, see docs/moduleTypes.md. */
export const RENDER_NODE = "RENDER";
export const VIDEO_OUT_NODE = "VIDEO_OUT";

/** The HEADPHONE bus — the one built-in output that leaves the mixer's sum entirely, see packages/song/docs/cue.md. */
export const CUE_NODE = "CUE";

/** The five built-in outputs — the two sums, and the three devices they leave by. */
export const BUILTIN_OUTPUTS = [
  MIX_NODE,
  OUT_NODE,
  RENDER_NODE,
  VIDEO_OUT_NODE,
  CUE_NODE,
] as const;
/** Is this name one of them? Neither has a folder on disk, so every "is it a module" test asks. */
export const isBuiltinOutput = (id: string): boolean =>
  (BUILTIN_OUTPUTS as readonly string[]).includes(id);

/** The owner a master chain's plugins are filed under while the document is built — a name, not a flag, see docs/moduleTypes.md. */
export const MASTER_OWNER = "@master";

/** The type folder COLD modules are filed in — never offered by the picker, packages/song/docs/coldModules.md. */
export const COLD_TYPE = "cold";

/** The type folder a CONSOLE's halves live in — placed by the compile, never offered as a module (packages/song/docs/console.md). */
export const CONSOLE_TYPE = "console";

/** The type folder a LANE belongs to — one category, and NOT one signal, see docs/moduleTypes.md. */
export const TRACK_CATEGORY = "tracks";

// What a module of each type EMITS (not its input — see docs/loader.md).
export const MODULE_EMITS: Record<
  string,
  "audio" | "midi" | "video" | undefined
> = {
  io: undefined, // a sink emits nothing; an io SOURCE is audio or PICTURE (see moduleEmits)
  instruments: "audio",
  audio: "audio",
  transformers: "midi",
  midi: "midi", // the legacy alias of transformers
  console: "audio",
  cold: "audio", // a whole-file pass, audio in and audio out; a separator names its own outputs
  video_effects: "video",
  video_transitions: "video",
  shaders: "video", // a shader takes picture and gives picture; its audio input is a side input
  shapes: "video", // …and a shape gives picture without taking any: it is a SOURCE, like a lens
};

/** Where a RACK keeps the audio its symbols name, inside its own folder — see docs/moduleFile.md. */
export const MODULE_SOURCES_DIR = "sources";

/** A shader module's own vocabulary — a shader is a PAIR of files, so it is a folder, see docs/moduleTypes.md. */
export const SHADERS_DIR = "shaders";
export const SHADER_VERTEX = "vertex.glsl";
export const SHADER_FRAGMENT = "fragment.glsl";

/** The TYPE FOLDER a shader module lives in — the same word as `SHADERS_DIR` and a different fact, see docs/moduleTypes.md. */
export const SHADER_CATEGORY = "shaders";

/** The TYPE FOLDER a transition module lives in; unlike a shader's, one is NAMED by a placement and never wired. */
export const TRANSITION_CATEGORY = "video_transitions";

/** The TYPE FOLDER a SHAPE module lives in — a drawn primitive, wired to a picture lane like a lens. */
export const SHAPE_CATEGORY = "shapes";

/** What a shape module DRAWS, named by its `shape:` field — see packages/song-video/docs/shapes.md. */
export const SHAPE_KINDS = ["square", "circle", "text"] as const;

/** The type folders whose modules ARE their behaviour — a shader's and a transition's GLSL, a
 *  shape's params. None of them hosts a plugin, so an empty `plugin:` is not a hole in one. */
export const PLUGINLESS_CATEGORIES = [
  SHADER_CATEGORY,
  SHAPE_CATEGORY,
  TRANSITION_CATEGORY,
] as const;

/** The type folders whose module is a PASS over a picture — what a lane's run, the frame's and a fade's stretch are made of. */
export const isPicturePass = (category: string | undefined): boolean =>
  category === SHADER_CATEGORY || category === "video_effects";

/** …asked the way every consumer wants it: does a module of this type folder hold a PLUGIN at all? */
export const hostsPlugin = (category: string | undefined): boolean =>
  !(PLUGINLESS_CATEGORIES as readonly string[]).includes(category ?? "");

/** The kind a bare `fade_in: 1` means — resolved by the renderer, so a plain fade needs no module on disk. */
export const DISSOLVE = "dissolve";

/** …and the kind a fade naming a `chain` and no `with` means: the shot's own alpha, laid over what is under it. */
export const OVER = "over";

/** The four knobs every shader gets, numbered rather than named and 0..1 — see packages/song-video/docs/shaders.md. */
export const SHADER_PARAMS = ["P1", "P2", "P3", "P4"] as const;
export type ShaderParam = (typeof SHADER_PARAMS)[number];
export const isShaderParam = (name: string): name is ShaderParam =>
  (SHADER_PARAMS as readonly string[]).includes(name);

/** The uniform each of them lands on — one rule, so a panel and a shader cannot disagree. */
export const shaderUniformFor = (param: string): string => `u${param}`;

// The signal leaving a module, from its type folder + its own io role — or, for a lane, its port.
export function moduleEmits(
  category: string | undefined,
  io?: string,
  outputs?: readonly { type: "audio" | "midi" | "video" }[],
): "audio" | "midi" | "video" | undefined {
  // A CAMERA is the one io source that is not audio — it is a live picture, docs/camera.md.
  if (category === "io")
    return io === CAMERA_IO
      ? "video"
      : io === MIDI_IN_IO
        ? "midi"
        : isIoSource(io)
          ? "audio"
          : undefined;
  // A lane's signal is its OWN, so the PORTS are read and two of them means undefined — see docs/moduleTypes.md.
  if (category === TRACK_CATEGORY) {
    const types = new Set((outputs ?? []).map((o) => o.type));
    return types.size === 1 ? outputs?.[0]?.type : undefined;
  }
  return MODULE_EMITS[category ?? ""];
}

/** One named port on a module, in or out; `mandatory` is an INPUT's business — see docs/moduleTypes.md. */
export interface PortDef {
  name: string;
  type: "audio" | "midi" | "video";
  mandatory?: boolean;
}

/** What a module IS at the coarsest level — four, not two, and the wire treats each differently: docs/moduleTypes.md. */
export type ModuleKind = "io" | "plugin" | "doc" | "track";

/** What a module of each type has when it says nothing itself — its DEFAULT ports, see docs/moduleTypes.md. */
export const MODULE_TYPES: Record<
  string,
  {
    kind: ModuleKind;
    inputs: PortDef[];
    outputs: PortDef[];
  }
> = {
  io: { kind: "io", inputs: [], outputs: [] },
  // A note on the graph: ONE input, NO output, and its `audio` type is only the ordinary cable (docs/moduleTypes.md).
  docs: {
    kind: "doc",
    inputs: [{ name: "in", type: "audio", mandatory: false }],
    outputs: [],
  },
  instruments: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "audio" }],
  },
  audio: {
    kind: "plugin",
    inputs: [{ name: "in", type: "audio" }],
    outputs: [{ name: "out", type: "audio" }],
  },
  transformers: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "midi" }],
  },
  video_effects: {
    kind: "plugin",
    inputs: [{ name: "in", type: "video" }],
    outputs: [{ name: "out", type: "video" }],
  },
  // NAMED by a placement, never wired: the ports stay declared but `validate()` refuses the cable.
  // Not emptied — empty ports mean UNCONSTRAINED here (graph.ts's normalizeInputs), the opposite.
  video_transitions: {
    kind: "plugin",
    inputs: [{ name: "in", type: "video" }],
    outputs: [{ name: "out", type: "video" }],
  },
  // A SHADER: picture in, picture out, and an audio SIDE input allowed to be empty (packages/song-video/docs/shaders.md).
  shaders: {
    kind: "plugin",
    inputs: [
      { name: "in", type: "video" },
      { name: "audio", type: "audio", mandatory: false },
    ],
    outputs: [{ name: "out", type: "video" }],
  },
  // A SHAPE: no input, one picture out. It is a picture SOURCE and lands on a lane the way a lens
  // does — `inputs: []` reads as unconstrained here, and validate() is what refuses a cable into one.
  shapes: {
    kind: "plugin",
    inputs: [],
    outputs: [{ name: "out", type: "video" }],
  },
  midi: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "midi" }],
  },
  // A COLD module: audio in, audio out, run over a whole file before playback (packages/song/docs/coldModules.md).
  cold: {
    kind: "plugin",
    inputs: [{ name: "in", type: "audio" }],
    outputs: [{ name: "out", type: "audio" }],
  },
  // One HALF of a summing console: placed by the compile from `project.console`, never wired by hand (packages/song/docs/console.md).
  console: {
    kind: "plugin",
    inputs: [{ name: "in", type: "audio" }],
    outputs: [{ name: "out", type: "audio" }],
  },
  // A LANE: TWO outputs since it is not typed by what it carries, and NO input deliberately (docs/moduleTypes.md).
  tracks: {
    kind: "track",
    inputs: [],
    outputs: [
      { name: "audio", type: "audio" },
      { name: "midi", type: "midi" },
    ],
  },
};

/** The type folder a scanned plugin belongs in — the single answer, since it decides the PORTS: docs/moduleTypes.md. */
export function categoryForRole(p: {
  role?: string;
  instrument?: boolean;
}): string {
  if (p.role === "midiEffect") return "transformers";
  if (p.role === "instrument" || p.instrument === true) return "instruments";
  return "audio";
}

/** How a chain names an engine module: `@engine/neural-amp-modeler`; here so a ref costs no `node:fs` (docs/moduleTypes.md). */
export const ENGINE_NS = "@engine";
export const engineRef = (slug: string): string => `${ENGINE_NS}/${slug}`;

/** Is this ref the ENGINE's — the one namespace with no folder, browsed rather than completed: docs/moduleTypes.md. */
export const isEngineRef = (ref: string): boolean =>
  ref === ENGINE_NS || ref.startsWith(`${ENGINE_NS}/`);

/** How a chain names a BUILT-IN — `@meta/track`, `@meta/IN` — the app's own vocabulary, never a scanned plugin (docs/moduleTypes.md). */
export const META_NS = "@meta";
export const metaRef = (slug: string): string => `${META_NS}/${slug}`;

/** Is this ref one of the built-ins? Asked wherever a ref's own namespace decides how it resolves. */
export const isMetaRef = (ref: string): boolean =>
  ref === META_NS || ref.startsWith(`${META_NS}/`);

/** How a module asks to be TREATED BY THE COMPLETIONS and nothing else — full rationale: docs/moduleStatus.md. */
export const MODULE_STATUSES = ["listed", "favorite", "hidden"] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];
export const DEFAULT_MODULE_STATUS: ModuleStatus = "listed";

/** A loaded module's status, `listed` for anything that does not say otherwise — forgiving on purpose, docs/moduleTypes.md. */
export const moduleStatusOf = (m: unknown): ModuleStatus => {
  const s = (m as { status?: unknown } | null | undefined)?.status;
  return s === "hidden" || s === "favorite" ? s : DEFAULT_MODULE_STATUS;
};

/** A completion list with the hidden dropped and the favourites floated up, STABLE within each group (docs/moduleTypes.md). */
export function completionOrder<T>(
  items: readonly T[],
  statusOf: (item: T) => ModuleStatus,
): T[] {
  const favorite: T[] = [];
  const listed: T[] = [];
  for (const it of items) {
    const s = statusOf(it);
    if (s === "hidden") continue;
    (s === "favorite" ? favorite : listed).push(it);
  }
  return [...favorite, ...listed];
}

/** The intrinsic a module's engine-side dry/wet is bound and sent by — engine/st0-engine/docs/mix.md. */
export const MIX_PARAM = "@mix";

/** …and the two LEVELS on the same engine stage, in dB: into an audio module, and out of anything with audio out. */
export const INPUT_VOLUME_PARAM = "@input-volume";
export const OUTPUT_VOLUME_PARAM = "@output-volume";

/** The range both levels take, in dB. */
export const VOLUME_RANGE = { min: -60, max: 12, def: 0 } as const;

/** Which LEVEL a plugin's own param is, by its WHOLE name — "Output", "Input Gain", "Out Level" — mirroring the engine's. */
export function ownLevelSide(name: string): "input" | "output" | null {
  if (/^(input|in)(\s+(volume|vol|gain|level|lvl|trim))?$/i.test(name))
    return "input";
  if (/^(output|out)(\s+(volume|vol|gain|level|lvl|trim))?$/i.test(name))
    return "output";
  return null;
}

/** Which way a plugin's OWN blend param is held when the engine owns the blend: all wet, or no dry — engine docs/mix.md. */
export function ownMixSide(name: string): "wet" | "dry" | null {
  if (name.startsWith("@")) return null;
  if (/\b(wet|mix)\b/i.test(name)) return "wet";
  if (/\bdry\b/i.test(name)) return "dry";
  return null;
}

/** The io kind a live PICTURE source is — spelled once, since three tiers test for it. */
export const CAMERA_IO = "camera";

/** The node a camera is: `@meta/CAM`, the picture's answer to `IN`. See docs/camera.md. */
export const CAMERA_NODE = "CAM";

/** The io kind a MIDI device is: notes FROM a keyboard, which the browser records — docs/midiIn.md in @studio/song. */
export const MIDI_IN_IO = "midi";

/** The node a MIDI device is: `@meta/MIDI`, the notes' answer to `IN`. */
export const MIDI_IN_NODE = "MIDI";

/** The io roles the app itself provides — one IN and one OUT for the whole app, and a node carries the wiring: docs/moduleTypes.md. */
export const IO_MODULES: Record<
  string,
  { io: "in" | "out" | "file" | "camera" | "midi" }
> = {
  IN: { io: "in" },
  OUT: { io: "out" },
  // A live PICTURE, and the one io source that emits video — the browser opens it, not the engine.
  [CAMERA_NODE]: { io: CAMERA_IO },
  // The headphone bus. An `out` like the interface, because that is what it is — a second pair of it.
  [CUE_NODE]: { io: "out" },
  // The file source: audio off disk rather than off an interface, and a node carries WHICH file (docs/fileInput.md).
  FILE: { io: "file" },
  // A MIDI keyboard: the notes a lane records, from the device its node names (docs/midiIn.md).
  [MIDI_IN_NODE]: { io: MIDI_IN_IO },
};

// --- curve refs (see packages/song/docs/curves.md) -------------------------------

/** The type folder a curve ref names — the file still lives at `curves/<id>.yaml`, per-project; this is REF-CONSISTENCY only. */
export const CURVES_CATEGORY = "curves";
const CURVE_REF_PREFIX = `${META_NS}/${CURVES_CATEGORY}/`;

/** How an automation binding names a curve: `@meta/curves/sweep` — docs/curves.md. */
export const curveRef = (id: string): string => `${CURVE_REF_PREFIX}${id}`;

/** The bare curve id an authored `curve:` field names, whichever form it was written in — docs/curves.md. */
export const curveIdFromRef = (ref: string): string =>
  ref.startsWith(CURVE_REF_PREFIX) ? ref.slice(CURVE_REF_PREFIX.length) : ref;

/** How a scanned plugin becomes a module, null when the name leaves no slug — ONE rule for two tiers, docs/moduleTypes.md. */
export function engineModuleOf(p: {
  name: string;
  format: string;
}): { ref: string; plugin: { type: string; name: string } } | null {
  const slug = slugifyPluginName(p.name ?? "");
  if (!slug) return null;
  // The FORMAT lowercased, never the role: the role mislabels a VST3 as whatever it does (docs/moduleTypes.md).
  return {
    ref: engineRef(slug),
    plugin: { type: String(p.format ?? "").toLowerCase(), name: p.name },
  };
}

/** The params whose value is a FILE the plugin loads, not a number — three tiers need the same list, docs/moduleTypes.md. */
export const FILE_PARAMS = ["model", "onnx"] as const;

/** An amp model is a NAM file or an RTNeural JSON (AIDA-X, Proteus) — engine/st0-engine/docs/namPlugin.md. */
const PARAM_EXTS: Record<string, readonly string[]> = {
  model: [".nam", ".json"],
};

/** The extensions a file-valued param takes: its table entry, else its NAME — `onnx` loads `.onnx`, see docs/moduleTypes.md. */
export const assetExtsFor = (param: string): readonly string[] =>
  PARAM_EXTS[param] ?? [`.${param.toLowerCase()}`];

/** What a rack TAP's sample picker asks for: a library's `samples/`, the way `ir` asks for its `irs/`. */
export const TAP_SAMPLE = "sample";

/** Those of `files` a param of this name can take — a library pick only the `@<library>/…` sound files; a panel naming its `family` filters by that. */
export function assetsForParam(
  files: string[],
  param: string,
  family?: string,
): string[] {
  // A Faust slot's name is the program's own, so only the family the panel names can say what it takes.
  if (family && isLibraryFileFamily(family)) {
    const exts = LIBRARY_FILE_FAMILIES[family];
    return files.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  }
  if (isLibraryFileParam(param) || param === TAP_SAMPLE)
    return files.filter((f) => f.startsWith("@") && isLibraryAudio(f));
  const exts = assetExtsFor(param);
  return files.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
}
export type FileParam = (typeof FILE_PARAMS)[number];

/** File-valued params whose file is in a LIBRARY's shared folder, named `@<library>/<path>` — packages/song/docs/libraryFiles.md. */
export const LIBRARY_FILE_PARAMS = { ir: "irs" } as const;
export type LibraryFileParam = keyof typeof LIBRARY_FILE_PARAMS;
export const isLibraryFileParam = (name: string): name is LibraryFileParam =>
  Object.hasOwn(LIBRARY_FILE_PARAMS, name);

/** The sound files a library's `samples/` and `irs/` hold — what those folders are walked for. */
export const LIBRARY_AUDIO_EXTS = [".wav", ".aif", ".aiff", ".flac"] as const;
export const isLibraryAudio = (path: string): boolean =>
  LIBRARY_AUDIO_EXTS.some((e) => path.toLowerCase().endsWith(e));

/** File params a module may fill from its own `assets/` OR from a library's shared folder — packages/song/docs/libraryFiles.md. */
export const SHARED_FILE_PARAMS = { model: "models" } as const;
export type SharedFileFamily =
  (typeof SHARED_FILE_PARAMS)[keyof typeof SHARED_FILE_PARAMS];

/** The library folders that hold FILES rather than modules, and what each one is walked for. */
export const LIBRARY_FILE_FAMILIES = {
  samples: LIBRARY_AUDIO_EXTS,
  irs: LIBRARY_AUDIO_EXTS,
  // Single-cycle frames end to end, what a Faust wavetable instrument's `soundfile` reads (packages/song/docs/faustFiles.md).
  wavetables: LIBRARY_AUDIO_EXTS,
  models: [".nam", ".json"],
} as const;
export type LibraryFileFamily = keyof typeof LIBRARY_FILE_FAMILIES;
export const isLibraryFileFamily = (name: string): name is LibraryFileFamily =>
  Object.hasOwn(LIBRARY_FILE_FAMILIES, name);

/** Is `path` a file a library's `family` folder holds? */
export const isLibraryFileOf = (
  family: LibraryFileFamily,
  path: string,
): boolean =>
  LIBRARY_FILE_FAMILIES[family].some((e) => path.toLowerCase().endsWith(e));

/** The library folder a file param can ALSO name a file in, by `@<library>/<path>`; null for the rest. */
export const sharedFamilyOf = (param: string): SharedFileFamily | null =>
  Object.hasOwn(SHARED_FILE_PARAMS, param)
    ? SHARED_FILE_PARAMS[param as keyof typeof SHARED_FILE_PARAMS]
    : null;
export const isFileParam = (name: string): name is FileParam =>
  (FILE_PARAMS as readonly string[]).includes(name);

/** `plugin: { type: offline }` — no engine plugin, its outputs produced onto disk by a pass first (docs/coldModules.md). */
export const OFFLINE_TYPE = "offline";

/** `plugin: { type: not_supported }` — the DELIBERATE marker: st0 knows this plugin and knows it cannot load it. */
export const NOT_SUPPORTED_TYPE = "not_supported";

// --- the doc module (see docs/docModules.md) -------------------------------------

/** `@meta/doc` — the module every note on the graph is a NODE of, and it names no folder (docs/moduleTypes.md). */
export const DOC_CATEGORY = "docs";
export const DOC_REF = `${META_NS}/doc`;

/** Is this what a note extends? The one spelling of the ref, so a typo cannot half-work. */
export const isDocRef = (ref: unknown): boolean => ref === DOC_REF;

// --- the not-supported module (see packages/song/docs/notSupported.md) -----------

/** `@meta/not-supported` — what a node stands on when the plugin it WAS is one st0 cannot load. */
export const NOT_SUPPORTED_REF = `${META_NS}/not-supported`;

/** Its category: not a type folder, so nothing can be authored under it — the module has no folder. */
export const NOT_SUPPORTED_CATEGORY = "misc";

/** Is this what an unsupported plugin's node extends? One spelling, so a typo cannot half-work. */
export const isNotSupportedRef = (ref: unknown): boolean =>
  ref === NOT_SUPPORTED_REF;

// --- the track modules (see docs/trackModules.md) --------------------------------

/** The three modules a LANE is a node of — three and not five, since a lane is not typed by its signal (docs/trackModules.md). */
export const TRACK_REF = `${META_NS}/track`;
export const STRUDEL_TRACK_REF = `${META_NS}/strudel-track`;
export const GROUP_TRACK_REF = `${META_NS}/group-track`;

export const TRACK_REFS = [
  TRACK_REF,
  STRUDEL_TRACK_REF,
  GROUP_TRACK_REF,
] as const;

/** The two output ports every non-group lane offers, from `@studio/graph-model` so the renderer cannot disagree (docs/moduleTypes.md). */
export {
  TRACK_OUT_AUDIO,
  TRACK_OUT_MIDI,
  TRACK_OUTPUTS,
} from "@studio/graph-model";

/** The signal-typed lane refs a project on disk may carry, for the DIAGNOSTIC alone — nothing resolves these (docs/moduleTypes.md). */
export const LEGACY_TRACK_REFS: Record<string, string> = {
  [`${META_NS}/audio-track`]: TRACK_REF,
  [`${META_NS}/sequence-track`]: TRACK_REF,
  [`${META_NS}/audio-strudel-track`]: STRUDEL_TRACK_REF,
  [`${META_NS}/sequence-strudel-track`]: STRUDEL_TRACK_REF,
};

/** Is this what a lane extends? Asked of an authored `extends:`, before anything is resolved. */
export const isTrackRef = (ref: unknown): boolean =>
  (TRACK_REFS as readonly unknown[]).includes(ref);

// --- ports (see docs/ports.md) --------------------------------------------------

// The port vocabulary lives in @studio/graph-model, the one tier both the compiler and the renderer reach (docs/moduleTypes.md).
export { PORT_SEP, portRef, splitPort } from "@studio/graph-model";

/** The two FIXED levels a module can live at; every other `@<name>` is one of the account's libraries — docs/moduleTypes.md. */
export const FIXED_NAMESPACES = ["engine", "workspace"] as const;

/** A module's level: `engine`, `workspace`, or the NAME of a library the account has cloned. */
export type ModuleNamespace = string;

/** The library an account's first repository is named, so every `@st0/…` written before libraries had names still resolves. */
export const DEFAULT_LIBRARY = "st0";

/** What a library may be called: a ref segment and a folder name at once, lowercase so no filesystem can disagree. */
export const LIBRARY_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The ACCOUNT's own library, `@account/…`: its forks of the origin's modules — docs/library-versions-plan.md. */
export const ACCOUNT_LIBRARY = "account";

/** Names a library cannot take, because a ref spelled with them already means something else. */
export const RESERVED_LIBRARY_NAMES: readonly string[] = [
  ...FIXED_NAMESPACES,
  ACCOUNT_LIBRARY,
  META_NS.slice(1),
  "studio", // LEGACY_META_NS
  "mediatek", // LEGACY_MEDIATEK_NS
];

/** Can a library be called this? */
export const isLibraryName = (name: string): boolean =>
  LIBRARY_NAME.test(name) && !RESERVED_LIBRARY_NAMES.includes(name);

/** `@<library>/<rest>` split into its library and the rest, or null for a ref no library answers to. */
export function libraryRefParts(
  ref: string,
): { library: string; rest: string } | null {
  const m = /^@([^/]+)\/(.+)$/.exec(ref);
  return m && (isLibraryName(m[1]) || m[1] === ACCOUNT_LIBRARY)
    ? { library: m[1], rest: m[2] }
    : null;
}

/** The ref a library gives the thing at `rest` inside it: `@st0/audio/reverb`. */
export const libraryRef = (library: string, rest: string): string =>
  `@${library}/${rest}`;

/** The other name this level answers to on disk — a NAME and not an accepted spelling, since nothing resolves it (docs/moduleTypes.md). */
export const LEGACY_MEDIATEK_NS = "mediatek";

/** `@meta`'s old spelling — a NAME for the migration script alone, since nothing resolves it (docs/moduleTypes.md). */
export const LEGACY_META_NS = "studio";

/** The folder the account's libraries answer to in a workspace's file API: `_libraries/<name>/…`, VIRTUAL — no workspace holds it on disk (docs/sharedFolders.md). */
export const LIBRARIES_DIR = "_libraries";

/** Where the file service clones them, under the machine's state (`<studioHome>/libraries/<name>`). */
export const LIBRARIES_HOME_DIR = "libraries";

/** Where automatic VST renders are cached, under the machine's state (`<studioHome>/.renders`) — never in a workspace (packages/song/docs/autoFreeze.md). */
export const AUTO_RENDERS_HOME_DIR = ".renders";

/** Where every project's undo journal is kept, under the machine's state (`<studioHome>/.history`) — never in a workspace (packages/file-service/docs/history.md). */
export const HISTORY_HOME_DIR = ".history";

/** The folder a WORKSPACE's own shared library sits in, at the workspace root — the `@workspace` level. */
export const SHARED_MODULES_DIR = "_modules";

// --- module nodes (see docs/loader.md) --------------------------------------
export const NODE_SEP = ":";

// The map key / chain reference for a module, with or without a node.
export const moduleKey = (module: string, node?: string): string =>
  node ? `${module}${NODE_SEP}${node}` : module;

// The bare form of a module's ref; an io module carries no type folder in its (docs/moduleTypes.md).
export const moduleRefOf = (type: string, name: string): string =>
  MODULE_TYPES[type]?.kind === "io" ? name : `${type}/${name}`;

/** The chain KEY of the module a path points into — everything between the type folder and the filename, docs/moduleTypes.md. */
export function moduleKeyFromPath(path: string): string | null {
  const segs = path.split(/[\\/]+/);
  // The LAST `modules/`, so a workspace-relative path and an absolute one land on the same segment.
  const at = segs.lastIndexOf("modules");
  if (at < 0) return null;
  const rest = segs.slice(at + 1);
  // <type> … <file>: at least a type, a module folder and a file.
  if (rest.length < 3 || !MODULE_TYPES[rest[0]]) return null;
  return rest.slice(1, -1).join("/");
}

// "synth:lead" -> {module, node}, splitting on the FIRST separator so it stays total on any key.
export function splitModuleKey(key: string): {
  module: string;
  node?: string;
} {
  const i = key.indexOf(NODE_SEP);
  return i < 0
    ? { module: key }
    : { module: key.slice(0, i), node: key.slice(i + 1) };
}

/** A plugin's real name as a filesystem- and ref-safe slug: "Neural Amp Modeler" -> "neural-amp-modeler". */
export function slugifyPluginName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
