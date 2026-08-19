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

/**
 * The type folder a LANE belongs to — the arrangement's own modules (see docs/trackModules.md).
 *
 * Up here with the rest of the vocabulary rather than beside the `@studio/…` refs at the foot of
 * this file, because `moduleEmits` has to ask about it: the five track modules share one category
 * and do NOT share one signal, which is the one place the folder stops being the answer.
 */
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
};

// The signal leaving a module, from its type folder + its own io role — or, for a lane, its port.
export function moduleEmits(
  category: string | undefined,
  io?: string,
  outputs?: readonly { type: "audio" | "midi" | "video" }[],
): "audio" | "midi" | "video" | undefined {
  if (category === "io") return isIoSource(io) ? "audio" : undefined;
  // A lane's signal is its OWN, not its folder's: an audio track and a sequence track are the
  // same kind of thing and differ only in the port they offer, so the port is what is read. A
  // group track offers none and emits nothing, which is right — it carries no signal.
  if (category === TRACK_CATEGORY) return outputs?.[0]?.type;
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
/**
 * What a module IS, at the coarsest level — which decides what happens to it at the wire.
 *
 * Four, not two. `plugin` becomes something the engine loads; `io` is an edge of the signal
 * (a source or a sink); `doc` is neither and is drawn on the graph without reaching the engine
 * at all; `track` is a LANE — where an arrangement's material enters the signal path, and what
 * a chain is named after. Calling a doc an `io` sink would have been cheaper by one union member
 * and would have made every "is this a sink" test answer yes about a note somebody wrote —
 * including the ones that decide what a chain ENDS on. A lane folded into `io` would be the same
 * mistake from the other side: it is a source, but every io source is a live channel or a file,
 * and none of the questions asked about those mean anything about a lane.
 */
export type ModuleKind = "io" | "plugin" | "doc" | "track";

export const MODULE_TYPES: Record<
  string,
  {
    kind: ModuleKind;
    inputs: PortDef[];
    outputs: PortDef[];
  }
> = {
  io: { kind: "io", inputs: [], outputs: [] },
  /**
   * A note on the graph. ONE input, NO output — see docs/docModules.md.
   *
   * The input is what attaches it: a note is wired from whatever it is about, so `ampli:
   * [ reverb, notes ]` says "this note is about the amp". No output, because a note is where a
   * run stops being signal — anything downstream of it would be documentation feeding audio.
   *
   * `audio` is the port type and it is not a claim about the note: nothing is carried, and the
   * graph refuses no wire into it (see `docPortType`). It is the type that draws the ordinary
   * cable, which is what a reader expects to see going into a comment about an audio chain.
   */
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
  midi: {
    kind: "plugin",
    inputs: [{ name: "midi", type: "midi" }],
    outputs: [{ name: "out", type: "midi" }],
  },
  /**
   * A LANE. The defaults here are the audio lane's, and every one of the five built-ins states
   * its own ports anyway (trackModule.ts) — because this is the one category whose members do
   * not share a signal. See docs/trackModules.md.
   *
   * NO input, deliberately. What arrives on a lane is its clips, and the one thing that may be
   * routed into it is a live interface channel — which the compiler lands on the lane rather
   * than wiring through a port, because the flat model the engine plays cannot express routing
   * into a lane's input. That is an engine ceiling, not a name-space artefact, so it stayed
   * exactly where it was when the two name spaces merged (`validate`'s out-check).
   */
  tracks: {
    kind: "track",
    inputs: [],
    outputs: [{ name: "out", type: "audio" }],
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
 * The io modules the engine provides. One IN and one OUT for the whole app — a project
 * makes nodes of them, and those carry the channel, the monitoring and the trim.
 *
 * They were files in `_modules` too, one folder plus one node per interface channel,
 * written by `module populate` from the machine's preferences. That put a rig's wiring in
 * a library shared by every song; the nodes belong to the song that records through
 * them.
 *
 * Here in the leaf rather than in engineCatalogue.ts, which reads the scan cache off disk:
 * a node that says `extends: "@engine/IN"` declares no `io:` of its own, so ANYTHING asking
 * what kind of module it is has to consult this table — including an editor in a browser,
 * which cannot pay a `node:fs` import to find out.
 */
export const IO_MODULES: Record<string, { io: "in" | "out" | "file" }> = {
  IN: { io: "in" },
  OUT: { io: "out" },
  // The file source: audio off disk rather than off an interface. One module, like the other
  // two, and a node carries WHICH file — or carries none, in a chain template, where the
  // audio belongs to whatever the template is applied to. See docs/fileInput.md.
  FILE: { io: "file" },
};

/**
 * How a scanned plugin becomes a module: the ref that names it, and the `plugin:` block that
 * says what to load. Null when the name leaves no slug to make a ref out of.
 *
 * ONE rule, here, because two tiers apply it and they have to agree exactly. `engineCatalogue`
 * synthesises the catalogue from the scan cache on the machine; a BROWSER resolves
 * `extends: "@engine/…"` against the same scan reported over the engine's socket, having no
 * project loader and no `node:fs`. A browser that spelt the type differently would preview a
 * plugin the compiled document never loads — silence, with a panel drawn over it.
 */
export function engineModuleOf(p: {
  name: string;
  format: string;
}): { ref: string; plugin: { type: string; name: string } } | null {
  const slug = slugifyPluginName(p.name ?? "");
  if (!slug) return null;
  // The FORMAT lowercased, never the role: `module populate` wrote `internal` whenever the
  // role was "instrument" and mislabelled forty VST3s (see engineCatalogue).
  return {
    ref: engineRef(slug),
    plugin: { type: String(p.format ?? "").toLowerCase(), name: p.name },
  };
}

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

// --- the doc module (see docs/docModules.md) -------------------------------------

/**
 * `@studio/doc` — the module every note on the graph is a NODE of.
 *
 * It names no folder, exactly as `@engine/nam` names none (docs/moduleNamespaces.md): there is
 * one doc module for the whole studio and nothing to scaffold, so a note costs one file — its
 * node — and nothing else. It is the second module in the repo that exists without a file,
 * and the first that exists without an engine behind it either.
 *
 * A note is a node because that is what a node IS here: one USE of a module with its
 * own settings. Two notes are two nodes of one module for the same reason two 4OSCs are.
 * Their setting happens to be text (`content`) rather than a number.
 *
 * `@studio` is its own level and not `@engine`, deliberately: the engine never hears of this.
 */
export const STUDIO_NS = "@studio";
export const DOC_CATEGORY = "docs";
export const DOC_REF = `${STUDIO_NS}/doc`;

/** Is this what a note extends? The one spelling of the ref, so a typo cannot half-work. */
export const isDocRef = (ref: unknown): boolean => ref === DOC_REF;

// --- the track modules (see docs/trackModules.md) --------------------------------

/**
 * The five modules a LANE is a node of. Like `@studio/doc`, none of them has a file
 * anywhere: there is one set for the whole studio, so a lane costs exactly its own node.
 *
 * Five and not two, because `type: single | group | strudel` × `contentType: audio | sequences`
 * was a two-axis vocabulary spelled as one field — which is the whole reason `contentType` had
 * to exist beside `type`. Flattened, the two questions (what signal does this lane carry, and
 * where do its clips come from) are both read off one `extends:`, and neither can go missing.
 */
export const AUDIO_TRACK_REF = `${STUDIO_NS}/audio-track`;
export const SEQUENCE_TRACK_REF = `${STUDIO_NS}/sequence-track`;
export const AUDIO_STRUDEL_TRACK_REF = `${STUDIO_NS}/audio-strudel-track`;
export const SEQUENCE_STRUDEL_TRACK_REF = `${STUDIO_NS}/sequence-strudel-track`;
export const GROUP_TRACK_REF = `${STUDIO_NS}/group-track`;

export const TRACK_REFS = [
  AUDIO_TRACK_REF,
  SEQUENCE_TRACK_REF,
  AUDIO_STRUDEL_TRACK_REF,
  SEQUENCE_STRUDEL_TRACK_REF,
  GROUP_TRACK_REF,
] as const;

/** Is this what a lane extends? Asked of an authored `extends:`, before anything is resolved. */
export const isTrackRef = (ref: unknown): boolean =>
  (TRACK_REFS as readonly unknown[]).includes(ref);

// --- ports (see docs/ports.md) --------------------------------------------------

// The port vocabulary lives in @studio/graph-model — a types-only tier with no dependencies,
// which is the one place BOTH the compiler and the graph renderer can reach. `ui-chains` draws
// ported edges and deliberately does not depend on this package (see graph-model's own note on
// why it was split out), so putting `splitPort` here would have meant a second copy there.
// Re-exported because this is where every module-vocabulary caller already looks.
export { PORT_SEP, portRef, splitPort } from "@studio/graph-model";

/**
 * The four levels a module can live at, outermost first. A ref carries the level as its
 * `@` prefix — `@engine/audio/nam`, `@st0/…`, `@workspace/…`, `@project/…` — and a
 * BARE ref (`audio/reverb`) is the project level written the short way.
 *
 * `engine` is the odd one: it names no folder at all. A scanned plugin is synthesised by
 * `engineCatalogue` from the machine's scan cache, so it is a level without a root.
 *
 * HERE and not beside `moduleNamespaceOf`, which decides a level from a folder on disk: this is
 * the vocabulary, and a browser has to spell it too — l8's Libraries tab writes `@st0` on a
 * row. `sharedFolders.ts` reads the disk on its first line, so importing it there would drag
 * `node:fs` into a bundle. Re-exported from it, exactly as `moduleKeyFromPath` is.
 *
 * `st0` is the médiathèque, which is called **pl8** now — and the level DELIBERATELY did not
 * follow it. A level is written into user files: every `@st0/…` in every chain of every
 * repository would have to be rewritten at once, on machines this repo does not have, and the
 * failure is silent enough to be nasty (a `?` on a graph node, nothing else). The app was
 * renamed for where it sits on the origin; the level names a folder of modules, which did not
 * move. `LEGACY_MEDIATEK_NS` below is what the last such rename cost, and is the argument for
 * not spending it again. See docs/moduleNamespaces.md.
 */
export const MODULE_NAMESPACES = [
  "engine",
  "st0",
  "workspace",
  "project",
] as const;
export type ModuleNamespace = (typeof MODULE_NAMESPACES)[number];

/**
 * What this level was called before, and nothing more: the app was `apps/mediatek` when the
 * levels were named, and became `apps/st0`, so the ref said one thing and the médiathèque
 * another. The level was rewritten to match, once. It has not moved since — the app is
 * `apps/pl8` today and the level is still `st0`, for the reason MODULE_NAMESPACES gives.
 *
 * Kept as a NAME rather than as an accepted spelling — nothing resolves it. A file still saying
 * `@mediatek/…` names a module that no longer exists, which the loader reports as such; this
 * constant exists so the migration and the diagnostics can say the old word out loud instead of
 * spelling it inline in three places. See scripts/migrateNamespace.ts.
 */
export const LEGACY_MEDIATEK_NS = "mediatek";

/**
 * Where the account's LIBRARY REPOSITORY is mounted, at the workspace root.
 *
 * A git submodule, put there by the file service, holding the two families a project inherits:
 * `modules/` and `chains/`. It is what `@st0/…` resolves against — the machine-wide
 * `~/.studio/mediatek` cache used to be, and no longer is.
 *
 * Fixed, and not declared anywhere: the same argument that removed `modules_from`. A path in a
 * `project.yaml` could be wrong about a folder the loader can simply look for.
 *
 * HERE rather than beside `moduleLibraryDirs`, for the reason MODULE_NAMESPACES is: a browser
 * names this folder too — l8's file tree keeps it off the Project tab, since it has a tab of
 * its own — and `sharedFolders.ts` reads the disk on its first line.
 * See docs/sharedFolders.md.
 */
export const LIBRARIES_DIR = "_libraries";

/** The folder a WORKSPACE's own shared library sits in, at the workspace root — the
 *  `@workspace` level. Here for the same reason `LIBRARIES_DIR` is: l8's file tree names it. */
export const SHARED_MODULES_DIR = "_modules";

/** …and where that is, relative to a project inside the workspace. */
export const LIBRARIES_PATH = `../${LIBRARIES_DIR}`;

// --- module nodes (see docs/loader.md) --------------------------------------
export const NODE_SEP = ":";

// The map key / chain reference for a module, with or without a node.
export const moduleKey = (module: string, node?: string): string =>
  node ? `${module}${NODE_SEP}${node}` : module;

// The ref a PROJECT-LOCAL module answers to — the keying loadModuleRefs uses, and what a `ui.yaml` panel answers to.
// An io module carries no type folder in its ref, which is why this isn't just `${type}/${name}`.
export const moduleRefOf = (type: string, name: string): string =>
  MODULE_TYPES[type]?.kind === "io" ? name : `${type}/${name}`;

/**
 * The chain KEY of the module a path points into — what `loadModules` files it under.
 *
 * `…/modules/audio/reverb/module.yaml` → `reverb`
 * `…/modules/audio/amps/neural-amp-modeler/ui.yaml` → `amps/neural-amp-modeler`
 *
 * Everything between the type folder and the filename, because a module may be FILED one level
 * deep (which is how the médiathèque lays its catalogue out, and therefore how the bench's own
 * `modules/` looks). Taking the folder immediately above the file instead gives `neural-amp-modeler`
 * — a name no chain uses and no lookup finds, which reads as "this project has no such module"
 * about a module plainly in the tree.
 *
 * Null when the path names no module. In this leaf rather than in the loader so a BROWSER can
 * ask: `@studio/song/loader` opens `node:fs` on import, and this is a question about a string.
 */
export function moduleKeyFromPath(path: string): string | null {
  const segs = path.split(/[\\/]+/);
  // The LAST `modules/`, so a workspace-relative path (`song.l8/modules/…`) and an absolute one
  // both land on the same segment.
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
