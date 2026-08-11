// build.ts — constructors for the documents in ./project, so an app with no song folder
// can still drive the engine. The ONLY runtime module in this package: `.` and `./project`
// are types and erase to nothing, this one emits code.
//
// It exists because a ProjectDoc has ~15 required fields and a TrackDoc ~17, most of which
// any given caller does not care about. Hand-written literals of those were already
// duplicated across two test files; st0's module preview and an m9 deck would
// each have added another.

import type {
  ClipDoc,
  PluginDoc,
  ProjectDoc,
  SettingsDoc,
  TrackDoc,
} from "./project";

/** Project settings the engine is happy with when nothing has been authored. */
export const DEFAULT_SETTINGS: SettingsDoc = { metronome: false, countIn: 0 };

/**
 * A valid, empty project. Every required field defaulted; override what you mean.
 *
 * `recordDir` defaults to `""`, which is a REFUSAL, not a blank: the engine rejects
 * arming a track with `"this song has no clips/ directory to record into"` (see
 * Recording.cpp) rather than recording a take that then has nowhere to go. That default
 * is right for a preview or a deck — surfaces that play and never record — and wrong the
 * moment you want to capture anything, so pass a real directory then.
 */
export function emptyDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    name: "",
    tempo: 120,
    sampleRate: 48000,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    tracks: [],
    groups: [],
    strudel: false,
    // A preview and a deck are neither shape, so the default is the one that assumes least:
    // `arrangement` is what a folder that says nothing is, everywhere else too.
    mode: "arrangement",
    markers: [],
    settings: DEFAULT_SETTINGS,
    ...over,
  };
}

/** A track. `id` is the one thing nothing can guess — everything else has a sane default. */
export function trackDoc(id: string, over: Partial<TrackDoc> = {}): TrackDoc {
  return {
    id,
    name: id,
    role: "regular",
    contentType: "audio",
    group: "",
    generated: false,
    color: "",
    mute: false,
    solo: false,
    disabled: false,
    inputChannels: [],
    monitor: "auto",
    inputGain: 0, // dB, 0 == unity
    clips: [],
    plugins: [],
    sends: [],
    automation: [],
    ...over,
  };
}

/** A clip. `type` decides which half of the shape matters, so it is required alongside `id`. */
export function clipDoc(
  over: Partial<ClipDoc> & Pick<ClipDoc, "id" | "type">,
): ClipDoc {
  return {
    name: "",
    source: "",
    start: 0,
    length: 0, // 0 == the source's natural length
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    ...over,
  };
}

/**
 * Formats loaded from disk via the scan cache, as opposed to a built-in named by its
 * xmlTypeName. Mirrors the engine's own isExternalFormat.
 */
export const EXTERNAL_PLUGIN_FORMATS = new Set([
  "vst3",
  "vst",
  "vst2",
  "au",
  "audiounit",
  "clap",
  "lv2",
  "ladspa",
  "aax",
]);

/**
 * The `plugin:` block of a module file, without a YAML parser.
 *
 * Lives beside `enginePlugin` — which consumes exactly what it produces — for the reason
 * stated there: a browser that needs to know what a module runs should not drag in a
 * parser, nor a module that reads the filesystem, for two scalars.
 *
 * Both spellings module files in this repo use are read: the indented block and the inline
 * flow map. Unparseable means `undefined`, never a throw — a module with no plugin is a
 * real thing (an io module), and the caller shows it as loading nothing.
 *
 * Third-copy rule: this started in st0's module preview, and m9 wanting the same
 * two scalars is what moved it here rather than making a second one.
 */
export function readPluginBlock(
  yaml: string,
): { type?: string; name?: string } | undefined {
  // The block form: `plugin:` on its own line, then the indented lines under it.
  const block = /^[ \t]*plugin:[ \t]*\r?\n((?:[ \t]+\S.*\r?\n?)*)/m.exec(yaml);
  const inline = /^[ \t]*plugin:[ \t]*\{([^}]*)\}/m.exec(yaml);
  const body = block?.[1] ?? inline?.[1];
  if (!body) return undefined;
  const field = (k: string): string | undefined =>
    new RegExp(`(?:^|[{,\\s])${k}\\s*:\\s*["']?([^"'\\n,}]+)`)
      .exec(body)?.[1]
      ?.trim();
  const type = field("type");
  const name = field("name");
  return type === undefined && name === undefined ? undefined : { type, name };
}

/** What an author writes for a module whose DSP is the `jsdsp.ts` beside it. */
export const JSDSP_TYPE = "jsdsp";
/** …and the built-in the engine actually loads for one: a host for a graph it is handed. */
export const DSP_GRAPH_PLUGIN = "DSP Graph";

/** The DSP source a `jsdsp` module carries. A fixed NAME, not a path: the type says the file
 *  is there, and a module stays a folder you can copy without rewriting anything inside it. */
export const JSDSP_FILE = "jsdsp.ts";

/**
 * The plugin type a mixer module instantiates. An internal plugin reaches the engine under its
 * DISPLAY name (see enginePlugin), so this is the string a compiled PluginDoc actually carries.
 *
 * Here rather than in @studio/song/project, which owns the compiler and opens `node:fs`: a
 * BROWSER that builds a document — m9's decks do — needs the word and not the compiler. That
 * file re-exports all three, so every existing importer is unchanged.
 */
export const MIXER_PLUGIN = "Mixer";

/** The five knobs a strip has, in the order a strip reads them. Also the param names in the module file. */
export const MIXER_PARAMS = ["Volume", "Pan", "Low", "Mid", "High"] as const;

/**
 * What a strip's `Volume` MEANS: decibels, floor to +6, with 0 at unity — never 0..1.
 *
 * Stated as a constant because a surface that guessed a 0..1 range would look like it worked
 * (the fader moves, the number changes) while sending +0.5 dB for what the user set to half.
 * The floor is silence as far as this vocabulary is concerned; anything quieter is the same.
 */
export const VOLUME_DB = { min: -60, max: 6, unity: 0 } as const;

/**
 * Map an authored `plugin: {type, name}` onto the engine's older wire form, where `type`
 * holds either a built-in's xmlTypeName or an external format. `fallback` is the module
 * name. Full mapping table: @studio/song's docs/enginePlugin.md.
 *
 * Lives here rather than with the song compiler that used to own it: this is a mapping
 * onto the WIRE, and a browser building a one-module document to preview needs it without
 * dragging in a module that reads the filesystem. `@studio/song` re-exports it.
 */
export function enginePlugin(
  plugin: { type?: unknown; name?: unknown } | undefined,
  fallback: string,
): { type: string; name: string } {
  const type = String(plugin?.type ?? "");
  const name = plugin?.name != null ? String(plugin.name) : "";
  // A module whose DSP is its own source. `jsdsp` is what the AUTHOR writes — it says where the
  // sound comes from — and the engine has no such plugin: it loads the built-in graph host and
  // is handed the compiled graph in the doc. The mapping is here so the author never has to
  // spell `internal` + `DSP Graph`, which said nothing about the file beside the module.
  if (type === JSDSP_TYPE) return { type: DSP_GRAPH_PLUGIN, name: fallback };
  if (type === "internal") return { type: name, name: fallback };
  if (EXTERNAL_PLUGIN_FORMATS.has(type.toLowerCase()))
    return { type, name: name || fallback };
  return { type, name: name || fallback }; // legacy: `type` is the xmlTypeName itself
}

/** A plugin instance. `id` is the engine's `chain:module` address — nothing else can supply it. */
export function pluginDoc(
  over: Partial<PluginDoc> & Pick<PluginDoc, "id">,
): PluginDoc {
  return {
    type: "",
    name: "",
    path: "",
    presetSave: "",
    role: "audioFX",
    enabled: true,
    params: {},
    ...over,
  };
}
