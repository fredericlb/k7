// project.ts — the compiled project the engine plays: the ProjectDoc tree, exactly as it
// goes on the wire. Types only, like the state frames beside it, so the C++ mirror in
// engine/ProjectDoc.h has one TypeScript counterpart and no more.
//
// This is NOT "a l8 song". It is the OUTPUT of a compiler, and any app that can build
// one can drive the engine — st0's module preview is a one-track doc, an m9 deck
// is two. That is why it lives here and not in @studio/song, which would drag the whole
// YAML compiler in behind it. `@studio/song` re-exports these and owns the code that
// PRODUCES them; `./build` has constructors for callers that have no song folder.

/**
 * Which of l8's two shapes a project has — a song placed in time, or a graph with no timeline.
 *
 * Here rather than in `@studio/song` because `ProjectDoc` carries it and this file is the one
 * TypeScript counterpart to the C++ mirror. `@studio/song` owns the YAML key (`project_type`),
 * the default and the list of values, and pins that list against THIS type with `satisfies` —
 * the same direction `PROJECT_TYPES` is pinned against `ProjectApp`, so the two can never drift
 * into disagreeing about what a mode is.
 *
 * The engine ignores it: it is handed tracks and plays them whichever shape they came from.
 */
export type ProjectMode = "arrangement" | "live";

// A named timeline marker from project.yaml's `markers` map; `beat` is that timecode in timeline beats.
export interface Marker {
  tc: string; // the map key — a canonical timecode, e.g. "5:1:1"
  name: string;
  beat: number;
}

// Project-level playback/recording settings, carried on every ProjectDoc and defaulted when the file is absent.
export interface SettingsDoc {
  metronome: boolean; // the project's stored click-track default (the engine also has a live toggle)
  countIn: number; // BARS the transport rolls before an armed track records; 0 == immediately
}

export interface NoteDoc {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  vel: number; // 0..1
  channel: number;
  rel: number; // release velocity 0..1
}

// Time-stretch for an audio clip: two markers is a linear stretch, more is piecewise (Tracktion's WarpTimeManager).
export interface WarpDoc {
  algorithm: string; // the stretch engine, e.g. "elastique" | "slice"
  markers: [number, number][]; // [timeline beat, source second]
}

export interface ClipDoc {
  id: string;
  type: "audio" | "midi";
  name: string;
  source: string; // audio: absolute path once loaded; midi: ''
  start: number; // beats
  length: number; // beats, 0 == natural length
  offset: number; // audio: source in-point; midi: playStart (beats)
  // The clip file's own window into its SOURCE, in seconds — `from`/`to` in clips/<id>.yaml. Every placement of
  // the clip plays that slice and no more. In seconds, unlike everything around them, because they measure into
  // a file: see AudioClipSchema.
  //
  // Optional, like `disabled`: a clip SYNTHESISED by the compiler — a freeze render, a pattern's clip — has no
  // clip file to be trimmed by, and absent says that better than a zero that has to be read as "no window".
  sourceFrom?: number; // seconds into the file; absent == from its start
  sourceTo?: number; // seconds into the file; absent == to its end
  fadeIn: number; // beats
  fadeOut: number; // beats
  loopStart: number; // midi (beats)
  loopEnd: number; // midi (beats); 0 == no loop
  notes: NoteDoc[]; // midi only
  warp?: WarpDoc; // audio only: time-stretch settings, when the clip carries a `warp`
  // Silenced without being removed — a track's `mute`, at the level of one event. It is
  // carried to the engine rather than filtered out here, because the timeline still has
  // to DRAW it: a disabled event you can't see is a deleted one.
  disabled?: boolean;
}

// One rack sound: a note playing a whole clip ("samples") or a window of the shared source ("slice").
export interface RackSoundDoc {
  symbol: string; // the short label (e.g. "BD") — carried for the engine's sound name
  note: number; // MIDI note 0..127 that triggers this sound
  clip: string; // absolute path to the audio file
  start: number; // seconds into the file (0 for a whole-clip sample)
  length: number; // seconds; 0 == the file's natural length (samples), else the slice length
}

export interface PluginDoc {
  id: string;
  type: string;
  name: string;
  path: string; // resolved .vstpreset to LOAD (the module's own, else the extended module's); '' if none
  irFile?: string; // convolution modules only — an audio file the project owns, unlike `path`'s opaque blob
  namFile?: string; // amp-modeller modules only (a .nam model) — see irFile
  // A DSP-graph module's description, INLINE as JSON rather than a path: the compiler has already read it, and
  // the engine parses no files. Its parameters come from it, so it must reach the plugin's constructor.
  dspGraph?: string;
  // The TRACK id feeding this module's SECOND input port — what a chains file writes as `crossfade#b`
  // (see @studio/song docs/ports.md), resolved to the lane the engine can route from. Absent when the
  // module has one input, or when a declared port is left unwired, which is a legitimate state.
  sidechainFrom?: string;
  presetSave: string; // absolute path where a UI edit saves THIS module's .vstpreset ('' if n/a)
  role: string; // "instrument" | "audioFX" | "noteFX"
  enabled: boolean;
  params: Record<string, number>;
  rack?: RackSoundDoc[]; // a rack instrument's sounds — only a `type: "rack"` module compiles to one
}

export interface SendDoc {
  to: string; // destination track id
  level: number;
  enabled: boolean;
}

// A baked automation lane: `points` are [beat, output] in the CURVE's range, which the engine maps onto the param.
export interface AutomationDoc {
  param: string;
  pluginId?: string; // the plugin whose param this drives (a `chain:module` id)
  bipolar?: boolean; // the source curve's polarity (default unipolar)
  points: [number, number][]; // [beat, output]
}

export interface TrackDoc {
  id: string;
  name: string;
  role: string; // "regular" | "effect" | "master"
  contentType: string; // "audio" | "notes" | "audio notes"
  group: string; // the group this belongs to ('' == none) — a group is never a lane, only this pointer plus an entry in `groups`
  generated: boolean; // true for a lane a pattern streams onto: its clips are the scheduler's look-ahead, rewritten every tick
  color: string;
  // No volume and no pan. They were the one part of a track's sound that lived outside its chain — nothing could
  // be placed after them and the graph could not show where they applied. They are a MODULE now (see
  // MixerPlugin), one instance at the end of each track's chain, so a level is a thing you can see and reorder.
  // Mute and solo stay: they are mixer-wide relationships between tracks, not a stage in one track's signal.
  mute: boolean;
  solo: boolean;
  disabled: boolean;
  inputChannels: number[]; // 1-based physical channels; a label is resolved against ~/.studio first, so the engine only ever sees numbers
  monitor: string; // Tracktion's "off" | "auto" (armed) | "on"; ignored when inputChannels is empty
  inputGain: number; // interface input trim in dB, 0 == unity; ignored when inputChannels is empty
  clips: ClipDoc[];
  plugins: PluginDoc[];
  sends: SendDoc[];
  automation: AutomationDoc[];
  // Authored notes / checklist, carried through for surfaces; the engine ignores both.
  docs?: string;
  todos?: string[];
  // Set while the track is frozen: the render it plays instead of its material, absolute. The engine ignores this
  // too — by the time the doc reaches it the render is already the track's one clip and the plugins are gone (see
  // nodeProject). It is here so a surface can say WHY a lane it can't edit looks the way it does.
  frozen?: string;
  // The track's clip-list VARIANTS, when it has more than one: every name in order, and which of
  // them `clips` above was resolved from. Ignored by the engine — it is handed the arrangement
  // that plays and has no use for the others — and here so a surface can offer the choice.
  // See packages/song/src/trackAlternatives.ts.
  alternatives?: string[];
  alternative?: string;
}

// A group track: it holds no material, so the engine plays no lane for it, but surfaces draw it over its members.
export interface GroupDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}

// PICTURE IS NOT HERE. It used to be — four interfaces and four ProjectDoc fields — and none
// of it ever reached the C++ engine: a `withoutVideo` step existed purely to take it back off
// again before the wire. It now belongs to the app that draws it, as @studio/song's videoDoc.ts
// (compiled) and @studio/web-protocol's WebVideoProject (browser). See apps/v1.

export interface ProjectDoc {
  uuid?: string; // stable song id, generated on first `l8 export`; absent until then
  name: string;
  tempo: number;
  sampleRate: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  // Where a live take lands ('' for a single-file song, which the engine refuses to arm) — the ONE path it is told.
  recordDir: string;
  tracks: TrackDoc[];
  groups: GroupDoc[]; // what the tracks' `group` pointers refer to; the engine ignores it
  strudel: boolean; // whether any track streams from an algo/ pattern — surfaces skip the clock poll when false
  // Which of l8's two shapes this project has — "arrangement" or "live". Ignored by the engine,
  // which plays the tracks it is given either way, and here for the same reason `strudel` is:
  // it is a fact the COMPILER already knows and every surface would otherwise re-read
  // project.yaml to learn. A live project has no timeline, so l8 draws the graph alone.
  // See packages/song/docs/projectMode.md.
  mode: ProjectMode;
  markers: Marker[]; // sorted by beat
  settings: SettingsDoc; // always present, defaulted when settings.yaml is absent
}
