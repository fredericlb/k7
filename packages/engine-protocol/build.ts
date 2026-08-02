// build.ts — constructors for the documents in ./project, so an app with no song folder
// can still drive the engine. The ONLY runtime module in this package: `.` and `./project`
// are types and erase to nothing, this one emits code.
//
// It exists because a ProjectDoc has ~15 required fields and a TrackDoc ~17, most of which
// any given caller does not care about. Hand-written literals of those were already
// duplicated across two test files; mediatek's module preview and a platines deck would
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
    video: false,
    viewport: [0, 0],
    fps: 30,
    videoTracks: [],
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
