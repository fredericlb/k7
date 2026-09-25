// build.ts — constructors for the documents in ./project, so an app with no song folder
// can still drive the engine. The ONLY runtime module in this package: `.` and `./project`
// are types and erase to nothing, this one emits code.
//
// It exists because a ProjectDoc has ~15 required fields and a TrackDoc ~17, most of which
// any given caller does not care about. Hand-written literals of those duplicate across every
// test file and every app that builds a document.

import type {
  ClipDoc,
  PluginDoc,
  ProjectDoc,
  SettingsDoc,
  TrackDoc,
} from "./project";

/** The click's level when `settings.yaml` names none — Tracktion's own default, here because `DEFAULT_SETTINGS` below needs it. */
export const DEFAULT_METRONOME_LEVEL = 0.6;

/** The quietest click there is — Tracktion's floor; stated once so the schema, the command and the slider all stop in the same place. */
export const METRONOME_MIN = 0.2;

/** Project settings the engine is happy with when nothing has been authored. */
export const DEFAULT_SETTINGS: SettingsDoc = {
  metronome: false,
  // Tracktion's own default, so a project that never mentions one sounds like the engine's idea of a metronome.
  metronomeLevel: DEFAULT_METRONOME_LEVEL,
  countIn: 0,
};

/** A valid, empty project; `recordDir: ""` is a REFUSAL rather than a blank, so pass a real directory to record anything. */
export function emptyDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    name: "",
    tempo: 120,
    sampleRate: 48000,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    masterVolume: 0, // unity — the fader after everything else
    masterPlugins: [], // no master chain: MIX reaches OUT as one wire
    recordDir: "",
    tracks: [],
    groups: [],
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
    outputChannels: [], // empty is the mixer's sum, which is where all but a CUE bus goes
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

/** Formats loaded from disk via the scan cache, as opposed to a built-in named by its xmlTypeName; mirrors the engine's isExternalFormat. */
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

/** The `plugin:` block of a module file, without a YAML parser; both spellings are read, and unparseable means `undefined` rather than a throw. */
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
/** Its twin over the NOTE stream. Tracktion routes the two differently, so a plugin cannot be both. */
export const MIDI_GRAPH_PLUGIN = "MIDI Graph";

/** The DSP source a `jsdsp` module carries: a fixed NAME, so a module stays a folder you can copy without rewriting anything inside it. */
export const JSDSP_FILE = "jsdsp.ts";

/** A module whose DSP is the Faust source beside it — `jsdsp`'s sibling, differing only in WHO compiles; packages/song/docs/faustModules.md. */
export const FAUST_TYPE = "faust";
/** …and the built-in that runs one: a host handed a source rather than a graph. */
export const FAUST_PLUGIN = "Faust";

/** The DSP source a `faust` module carries. Fixed, for the reason JSDSP_FILE is. */
export const FAUST_FILE = "dsp.dsp";

/** The plugin type a mixer module instantiates — an internal plugin reaches the engine under its DISPLAY name, so this is what a PluginDoc carries. */
export const MIXER_PLUGIN = "Mixer";

/** …and a RECORDER node's, spelled the same way and for the same reason — engine docs/recorder.md. */
export const RECORDER_PLUGIN = "Recorder";

/** The five knobs a strip has, in the order a strip reads them. Also the param names in the module file. */
export const MIXER_PARAMS = ["Volume", "Pan", "Low", "Mid", "High"] as const;

/** What a strip's `Volume` MEANS: decibels, floor to +6, 0 at unity — never 0..1, which would look like it worked and send +0.5 dB for half. */
export const VOLUME_DB = { min: -60, max: 6, unity: 0 } as const;

/** Map an authored `plugin: {type, name}` onto the engine's older wire form, `fallback` being the module name — @studio/song's docs/enginePlugin.md. */
export function enginePlugin(
  plugin: { type?: unknown; name?: unknown } | undefined,
  fallback: string,
  // What the module EMITS. A jsdsp graph has two hosts and this is what picks between them: the
  // module's type folder already says which, so nothing new is authored — docs/enginePlugin.md.
  emits?: string,
): { type: string; name: string } {
  const type = String(plugin?.type ?? "");
  const name = plugin?.name != null ? String(plugin.name) : "";
  // `jsdsp` is what the AUTHOR writes; the engine has no such plugin, so it loads the graph host and is handed the compiled graph.
  if (type === JSDSP_TYPE)
    return {
      type: emits === "midi" ? MIDI_GRAPH_PLUGIN : DSP_GRAPH_PLUGIN,
      name: fallback,
    };
  // …and its sibling, whose source the ENGINE compiles. Same shape of mapping, same reason.
  if (type === FAUST_TYPE) return { type: FAUST_PLUGIN, name: fallback };
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
