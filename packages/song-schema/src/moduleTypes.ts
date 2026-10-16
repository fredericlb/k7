// moduleTypes.ts — the module vocabulary, with no filesystem: the type folders and what each
// one means, plus how a module is NAMED. It re-exports its three parts — `metaRefs.ts`,
// `fileParams.ts`, `moduleKeys.ts` — and imports nothing else but `@studio/graph-model`.
//
// A leaf on purpose. These tables are the one thing everything about a module derives
// from — `kind`, `inputs`, `emits`, the ref a `ui.yaml` panel answers to — so knowing what
// `audio/` means costs no import of a loader that reads files, and the engine catalogue
// (which knows about plugins and nothing about folders) can reach them without a cycle.

import { META_NS } from "./metaRefs";
import { slugifyPluginName } from "./moduleKeys";

export * from "./fileParams";
export * from "./metaRefs";
export * from "./moduleKeys";

/** The io roles the signal comes FROM; everything else under `io/` is a sink by ELIMINATION — see docs/moduleTypes.md. */
const IO_SOURCES = ["in", "file", "camera", "midi"] as const;
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
const BUILTIN_OUTPUTS = [
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

/** The type folders whose modules ARE their behaviour (GLSL, a shape's params), so an empty `plugin:` is no hole. */
const PLUGINLESS_CATEGORIES = [
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
  // NAMED by a placement, never wired: ports stay declared (empty means UNCONSTRAINED) and `validate()` refuses the cable.
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
  // A SHAPE: a picture SOURCE on a lane like a lens; `inputs: []` is unconstrained, and validate() refuses a cable in.
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

/** The intrinsic a module's engine-side dry/wet is bound and sent by — engine/k7-runtime/docs/mix.md. */
export const MIX_PARAM = "@mix";

/** …and the two LEVELS on the same engine stage, in dB: into an audio module, and out of anything with audio out. */
export const INPUT_VOLUME_PARAM = "@input-volume";
export const OUTPUT_VOLUME_PARAM = "@output-volume";

/** The range both levels take, in dB. */
export const VOLUME_RANGE = { min: -60, max: 12, def: 0 } as const;

/** A rack's first pad note: 36 is C1, General MIDI's kick, where every pad convention starts. */
export const RACK_FIRST_NOTE = 36;

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

/** `plugin: { type: offline }` — no engine plugin, its outputs produced onto disk by a pass first (docs/coldModules.md). */
export const OFFLINE_TYPE = "offline";

/** `plugin: { type: not_supported }` — the DELIBERATE marker: k7 knows this plugin and knows it cannot load it. */
export const NOT_SUPPORTED_TYPE = "not_supported";

// --- ports (see docs/ports.md) --------------------------------------------------

// The port vocabulary lives in @studio/graph-model, the one tier both the compiler and the renderer reach (docs/moduleTypes.md).
export { portRef, splitPort } from "@studio/graph-model";

/** The two FIXED levels a module can live at; every other `@<name>` is one of the account's libraries — docs/moduleTypes.md. */
export const FIXED_NAMESPACES = ["engine", "workspace"] as const;

/** A module's level: `engine`, `workspace`, or the NAME of a library the account has cloned. */
export type ModuleNamespace = string;

/** The library an account's first repository is named, so every `@k7-core/…` written before libraries had names still resolves. */
export const DEFAULT_LIBRARY = "k7-core";

/** What a library may be called: a ref segment and a folder name at once, lowercase so no filesystem can disagree. */
const LIBRARY_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The ACCOUNT's own library, `@account/…`: its forks of the origin's modules — docs/library-versions-plan.md. */
export const ACCOUNT_LIBRARY = "account";

/** Names a library cannot take, because a ref spelled with them already means something else. */
const RESERVED_LIBRARY_NAMES: readonly string[] = [
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

/** The ref a library gives the thing at `rest` inside it: `@k7-core/audio/reverb`. */
export const libraryRef = (library: string, rest: string): string =>
  `@${library}/${rest}`;

/** The other name this level answers to on disk — a NAME and not an accepted spelling, since nothing resolves it (docs/moduleTypes.md). */
export const LEGACY_MEDIATEK_NS = "mediatek";

/** The default library's name before it was `k7-core` — a NAME for the migration script alone, since nothing resolves it. */
export const LEGACY_DEFAULT_LIBRARY = "st0";

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
