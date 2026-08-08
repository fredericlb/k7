// moduleTypes.ts — the module vocabulary, with no filesystem and no imports: the type
// folders and what each one means, plus how a module is NAMED (instance keys, refs, the
// slug a plugin earns).
//
// A leaf on purpose. These tables are the one thing everything about a module derives
// from — `kind`, `inputs`, `emits`, the ref a `ui.yaml` panel answers to — and they were
// inside loader.ts, which reads files. Anything wanting to know what `audio/` means had
// to import the loader, and the engine catalogue (which knows about plugins and nothing
// about folders) could not import it at all without a cycle. loader.ts re-exports every
// name below, so no existing importer changes.

/**
 * The io roles the signal comes FROM. Everything else under `io/` is a sink.
 *
 * Two of them, and they differ in where the audio comes from rather than in what they are:
 * `in` is a live interface channel, `file` reads an audio file (see docs/fileInput.md).
 * Stated as a list because the graph decides "sink" by ELIMINATION — an io module is a sink
 * unless it is a source — so a role added without joining this list becomes a silent sink,
 * and a chain would route INTO the thing meant to feed it.
 */
export const IO_SOURCES = ["in", "file"] as const;
export type IoSource = (typeof IO_SOURCES)[number];
export const isIoSource = (io: unknown): io is IoSource =>
  (IO_SOURCES as readonly unknown[]).includes(io);

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
};

// The signal leaving a module, from its type folder + its own io role.
export function moduleEmits(
  category: string | undefined,
  io?: string,
): "audio" | "midi" | "video" | undefined {
  if (category === "io") return isIoSource(io) ? "audio" : undefined;
  return MODULE_EMITS[category ?? ""];
}

/** One named port on a module, in or out. `mandatory` is an INPUT's business — an output is
 *  offered, never required — and defaults to true where it is read (see graph's normalizeInputs). */
export interface PortDef {
  name: string;
  type: "audio" | "midi" | "video";
  mandatory?: boolean;
}

/**
 * What a module of each type has, when it says nothing itself — its DEFAULT ports.
 *
 * A module may declare its own (`inputs:` / `outputs:` in module.yaml), and then these are not
 * consulted at all: the type folder decides what a module IS, and a module that needs two audio
 * inputs is still an audio effect. Before that was possible the folder was the only source, so
 * "two inputs" was unsayable — which is what a crossfade needs and could not have.
 *
 * `outputs` is new beside `inputs`, and deliberately not derived from `emits`: `emits` says what
 * KIND of signal leaves (one word, used for cable colour), while a port is a place something can
 * be wired to. One output is the overwhelming default, and naming it lets the rest be named too.
 */
export const MODULE_TYPES: Record<
  string,
  {
    kind: "io" | "plugin";
    inputs: PortDef[];
    outputs: PortDef[];
  }
> = {
  io: { kind: "io", inputs: [], outputs: [] },
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
  midi: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "midi" }],
  },
};

/**
 * The type folder a scanned plugin belongs in, from what the scan says about it.
 *
 * The single answer to that question. It used to live inside populateModules, which is
 * why it read as a filing rule; it is really what decides the module's PORTS — a midi
 * effect takes midi and gives midi back, an instrument takes midi and gives audio — so
 * the engine catalogue and the folder writer have to agree, and now they cannot disagree.
 */
export function categoryForRole(p: {
  role?: string;
  instrument?: boolean;
}): string {
  if (p.role === "midiEffect") return "transformers";
  if (p.role === "instrument" || p.instrument === true) return "instruments";
  return "audio";
}

/** How a chain names an engine module: `@engine/neural-amp-modeler`. Here rather than in
 *  engineCatalogue.ts, which reads the scan cache off disk — naming a ref must not cost a
 *  `node:fs` import, or the médiathèque could not scaffold one from a browser. */
export const ENGINE_NS = "@engine";
export const engineRef = (slug: string): string => `${ENGINE_NS}/${slug}`;

/**
 * The params whose value is a FILE the plugin loads, not a number — named here, beside the
 * rest of the module vocabulary and free of `node:fs`, because three tiers need the same list:
 * the loader resolves them against the module's `assets/`, nodeProject lifts them off the wire
 * (which stays numeric), and the panel draws them as a dropdown of that folder rather than a
 * knob. A param not in this list is a number, and that is still the overwhelming majority.
 */
export const FILE_PARAMS = ["nam", "onnx"] as const;

/**
 * The extension a file-valued param takes — `nam` loads `.nam`, `onnx` loads `.onnx`.
 *
 * Derived from the param's NAME rather than declared on the widget that picks it, because those
 * two facts have never disagreed: the param is named after the format it loads. A widget that had
 * to repeat it would be a second place to get it wrong, and its author already wrote `bind: nam`.
 *
 * Here, beside FILE_PARAMS and free of `node:fs`, because the PICKER runs in a browser: the panel
 * filters the module's assets down to the ones its param can take. `moduleAssetChoices` reads
 * disk and is the node-only half.
 */
export const assetExtFor = (param: string): string => `.${param.toLowerCase()}`;

/** Those of `files` a param of this name can take. */
export function assetsForParam(files: string[], param: string): string[] {
  const ext = assetExtFor(param);
  return files.filter((f) => f.toLowerCase().endsWith(ext));
}
export type FileParam = (typeof FILE_PARAMS)[number];
export const isFileParam = (name: string): name is FileParam =>
  (FILE_PARAMS as readonly string[]).includes(name);

/**
 * `plugin: { type: offline }` — a module with NO engine plugin, whose outputs are produced
 * onto disk by a pass before the render.
 *
 * It lives here and not in `@studio/engine-protocol/build` beside `JSDSP_TYPE` because it is
 * the one plugin type that never reaches the wire: there is nothing for the engine to load.
 * That is also why it must be a WORD — the compiler's gate drops any type it does not know,
 * silently, and a module dropped for being unknown is indistinguishable from one dropped for
 * being offline. See docs/coldModules.md.
 */
export const OFFLINE_TYPE = "offline";

// --- ports (see docs/ports.md) --------------------------------------------------

// The port vocabulary lives in @studio/graph-model — a types-only tier with no dependencies,
// which is the one place BOTH the compiler and the graph renderer can reach. `ui-chains` draws
// ported edges and deliberately does not depend on this package (see graph-model's own note on
// why it was split out), so putting `splitPort` here would have meant a second copy there.
// Re-exported because this is where every module-vocabulary caller already looks.
export { PORT_SEP, portRef, splitPort } from "@studio/graph-model";

// --- module instances (see docs/loader.md) --------------------------------------
export const INSTANCE_SEP = ":";

// The map key / chain reference for a module, with or without an instance.
export const moduleKey = (module: string, instance?: string): string =>
  instance ? `${module}${INSTANCE_SEP}${instance}` : module;

// The ref a PROJECT-LOCAL module answers to — the keying loadModuleRefs uses, and what a `ui.yaml` panel answers to.
// An io module carries no type folder in its ref, which is why this isn't just `${type}/${name}`.
export const moduleRefOf = (type: string, name: string): string =>
  MODULE_TYPES[type]?.kind === "io" ? name : `${type}/${name}`;

// "synth:lead" -> {module, instance}, splitting on the FIRST separator so it stays total on any key.
export function splitModuleKey(key: string): {
  module: string;
  instance?: string;
} {
  const i = key.indexOf(INSTANCE_SEP);
  return i < 0
    ? { module: key }
    : { module: key.slice(0, i), instance: key.slice(i + 1) };
}

/** A plugin's real name as a filesystem- and ref-safe slug: "Neural Amp Modeler" -> "neural-amp-modeler". */
export function slugifyPluginName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
