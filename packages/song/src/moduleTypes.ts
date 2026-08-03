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

// What a module of each type EMITS (not its input — see docs/loader.md).
export const MODULE_EMITS: Record<
  string,
  "audio" | "midi" | "video" | undefined
> = {
  io: undefined, // a sink emits nothing; io "in" is audio (see moduleEmits)
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
  if (category === "io") return io === "in" ? "audio" : undefined;
  return MODULE_EMITS[category ?? ""];
}

export const MODULE_TYPES: Record<
  string,
  {
    kind: "io" | "plugin";
    inputs: { name: string; type: "audio" | "midi" | "video" }[];
  }
> = {
  io: { kind: "io", inputs: [] },
  instruments: { kind: "plugin", inputs: [{ name: "midi", type: "midi" }] },
  audio: { kind: "plugin", inputs: [{ name: "in", type: "audio" }] },
  transformers: { kind: "plugin", inputs: [{ name: "midi", type: "midi" }] },
  video_effects: { kind: "plugin", inputs: [{ name: "in", type: "video" }] },
  video_transitions: {
    kind: "plugin",
    inputs: [{ name: "in", type: "video" }],
  },
  midi: { kind: "plugin", inputs: [{ name: "midi", type: "midi" }] },
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
