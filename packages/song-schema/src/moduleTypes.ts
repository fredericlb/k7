// moduleTypes.ts — the module vocabulary, with no filesystem and no imports: the type
// folders and what each one means, plus how a module is NAMED (node keys, refs, the
// slug a plugin earns).
//
// A leaf on purpose. These tables are the one thing everything about a module derives
// from — `kind`, `inputs`, `emits`, the ref a `ui.yaml` panel answers to — and they were
// inside loader.ts, which reads files. Anything wanting to know what `audio/` means had
// to import the loader, and the engine catalogue (which knows about plugins and nothing
// about folders) could not import it at all without a cycle. loader.ts re-exports every
// name below, so no existing importer changes.

/** The io roles the signal comes FROM; everything else under `io/` is a sink by ELIMINATION — see docs/moduleTypes.md. */
export const IO_SOURCES = ["in", "file"] as const;
export type IoSource = (typeof IO_SOURCES)[number];
export const isIoSource = (io: unknown): io is IoSource =>
  (IO_SOURCES as readonly unknown[]).includes(io);

/** The two BUILT-IN audio outputs: `MIX` is where the mixer sums, `OUT` is the interface — see docs/moduleTypes.md. */
export const MIX_NODE = "MIX";
export const OUT_NODE = "OUT";

/** The same two for PICTURE, on a project that declares a viewport — and added automatically, see docs/moduleTypes.md. */
export const RENDER_NODE = "RENDER";
export const VIDEO_OUT_NODE = "VIDEO_OUT";

/** The four built-in outputs — the two sums, and the two devices they leave by. */
export const BUILTIN_OUTPUTS = [
  MIX_NODE,
  OUT_NODE,
  RENDER_NODE,
  VIDEO_OUT_NODE,
] as const;
/** Is this name one of them? Neither has a folder on disk, so every "is it a module" test asks. */
export const isBuiltinOutput = (id: string): boolean =>
  (BUILTIN_OUTPUTS as readonly string[]).includes(id);

/** The owner a master chain's plugins are filed under while the document is built — a name, not a flag, see docs/moduleTypes.md. */
export const MASTER_OWNER = "@master";

/** The type folder a LANE belongs to — one category, and NOT one signal, see docs/moduleTypes.md. */
export const TRACK_CATEGORY = "tracks";

// What a module of each type EMITS (not its input — see docs/loader.md).
export const MODULE_EMITS: Record<
  string,
  "audio" | "midi" | "video" | undefined
> = {
  io: undefined, // a sink emits nothing; an io SOURCE is audio (see moduleEmits)
  instruments: "audio",
  audio: "audio",
  transformers: "midi",
  midi: "midi", // the legacy alias of transformers
  video_effects: "video",
  video_transitions: "video",
  shaders: "video", // a shader takes picture and gives picture; its audio input is a side input
};

/** A shader module's own vocabulary — a shader is a PAIR of files, so it is a folder, see docs/moduleTypes.md. */
export const SHADERS_DIR = "shaders";
export const SHADER_VERTEX = "vertex.glsl";
export const SHADER_FRAGMENT = "fragment.glsl";

/** The TYPE FOLDER a shader module lives in — the same word as `SHADERS_DIR` and a different fact, see docs/moduleTypes.md. */
export const SHADER_CATEGORY = "shaders";

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
  if (category === "io") return isIoSource(io) ? "audio" : undefined;
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
  midi: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "midi" }],
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

/** The io modules the engine provides — one IN and one OUT for the whole app, and a node carries the wiring: docs/moduleTypes.md. */
export const IO_MODULES: Record<string, { io: "in" | "out" | "file" }> = {
  IN: { io: "in" },
  OUT: { io: "out" },
  // The file source: audio off disk rather than off an interface, and a node carries WHICH file (docs/fileInput.md).
  FILE: { io: "file" },
};

/** How a scanned plugin becomes a module, null when the name leaves no slug — ONE rule for two tiers, docs/moduleTypes.md. */
export function engineModuleOf(p: {
  name: string;
  format: string;
}): { ref: string; plugin: { type: string; name: string } } | null {
  const slug = slugifyPluginName(p.name ?? "");
  if (!slug) return null;
  // The FORMAT lowercased, never the role: taking the role mislabelled forty VST3s (docs/moduleTypes.md).
  return {
    ref: engineRef(slug),
    plugin: { type: String(p.format ?? "").toLowerCase(), name: p.name },
  };
}

/** The params whose value is a FILE the plugin loads, not a number — three tiers need the same list, docs/moduleTypes.md. */
export const FILE_PARAMS = ["nam", "onnx"] as const;

/** The extension a file-valued param takes, derived from the param's NAME — `nam` loads `.nam`, see docs/moduleTypes.md. */
export const assetExtFor = (param: string): string => `.${param.toLowerCase()}`;

/** Those of `files` a param of this name can take. */
export function assetsForParam(files: string[], param: string): string[] {
  const ext = assetExtFor(param);
  return files.filter((f) => f.toLowerCase().endsWith(ext));
}
export type FileParam = (typeof FILE_PARAMS)[number];
export const isFileParam = (name: string): name is FileParam =>
  (FILE_PARAMS as readonly string[]).includes(name);

/** `plugin: { type: offline }` — no engine plugin, its outputs produced onto disk by a pass first (docs/coldModules.md). */
export const OFFLINE_TYPE = "offline";

// --- the doc module (see docs/docModules.md) -------------------------------------

/** `@studio/doc` — the module every note on the graph is a NODE of, and it names no folder (docs/moduleTypes.md). */
export const STUDIO_NS = "@studio";
export const DOC_CATEGORY = "docs";
export const DOC_REF = `${STUDIO_NS}/doc`;

/** Is this what a note extends? The one spelling of the ref, so a typo cannot half-work. */
export const isDocRef = (ref: unknown): boolean => ref === DOC_REF;

// --- the track modules (see docs/trackModules.md) --------------------------------

/** The three modules a LANE is a node of — three and not five, since a lane is not typed by its signal (docs/trackModules.md). */
export const TRACK_REF = `${STUDIO_NS}/track`;
export const STRUDEL_TRACK_REF = `${STUDIO_NS}/strudel-track`;
export const GROUP_TRACK_REF = `${STUDIO_NS}/group-track`;

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

/** What a lane extended when `extends:` still said its signal, for the DIAGNOSTIC alone — nothing resolves these (docs/moduleTypes.md). */
export const LEGACY_TRACK_REFS: Record<string, string> = {
  [`${STUDIO_NS}/audio-track`]: TRACK_REF,
  [`${STUDIO_NS}/sequence-track`]: TRACK_REF,
  [`${STUDIO_NS}/audio-strudel-track`]: STRUDEL_TRACK_REF,
  [`${STUDIO_NS}/sequence-strudel-track`]: STRUDEL_TRACK_REF,
};

/** Is this what a lane extends? Asked of an authored `extends:`, before anything is resolved. */
export const isTrackRef = (ref: unknown): boolean =>
  (TRACK_REFS as readonly unknown[]).includes(ref);

// --- ports (see docs/ports.md) --------------------------------------------------

// The port vocabulary lives in @studio/graph-model, the one tier both the compiler and the renderer reach (docs/moduleTypes.md).
export { PORT_SEP, portRef, splitPort } from "@studio/graph-model";

/** The four levels a module can live at, outermost first — and `@st0` names the MÉDIATHÈQUE, not the app: docs/moduleTypes.md. */
export const MODULE_NAMESPACES = [
  "engine",
  "st0",
  "workspace",
  "project",
] as const;
export type ModuleNamespace = (typeof MODULE_NAMESPACES)[number];

/** What this level was called before and nothing more — a NAME, not an accepted spelling, since nothing resolves it (docs/moduleTypes.md). */
export const LEGACY_MEDIATEK_NS = "mediatek";

/** Where the account's LIBRARY REPOSITORY is mounted at the workspace root — fixed, never declared (docs/sharedFolders.md). */
export const LIBRARIES_DIR = "_libraries";

/** The folder a WORKSPACE's own shared library sits in, at the workspace root — the `@workspace` level. */
export const SHARED_MODULES_DIR = "_modules";

/** …and where that is, relative to a project inside the workspace. */
export const LIBRARIES_PATH = `../${LIBRARIES_DIR}`;

// --- module nodes (see docs/loader.md) --------------------------------------
export const NODE_SEP = ":";

// The map key / chain reference for a module, with or without a node.
export const moduleKey = (module: string, node?: string): string =>
  node ? `${module}${NODE_SEP}${node}` : module;

// The ref a PROJECT-LOCAL module answers to; an io module carries no type folder in its (docs/moduleTypes.md).
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
