// project.ts — the compiled project the engine plays: the ProjectDoc tree, exactly as it
// goes on the wire. Types only, like the state frames beside it, so the C++ mirror in
// engine/ProjectDoc.h has one TypeScript counterpart and no more.
//
// This is NOT "a pistes song". It is the OUTPUT of a compiler, and any app that can build
// one can drive the engine — mediatek's module preview is a one-track doc, an m9 deck
// is two. That is why it lives here and not in @studio/song, which would drag the whole
// YAML compiler in behind it. `@studio/song` re-exports these and owns the code that
// PRODUCES them; `./build` has constructors for callers that have no song folder.

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
}

// A group track: it holds no material, so the engine plays no lane for it, but surfaces draw it over its members.
export interface GroupDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}

// A video clip. Times are SECONDS, not beats — picture is cut against the wall clock, not the bar line.
export interface VideoClipDoc {
  id: string;
  name: string;
  source: string; // absolute path
  start: number; // seconds on the timeline
  length: number; // seconds; 0 == the source's natural length
  sourceFrom: number; // seconds, the in-point INTO the source
}

// A shape drawn straight onto the viewport, in px. A square/text x,y is its top-left, a circle's its CENTRE.
export type ShapeDoc =
  | {
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | { type: "circle"; x: number; y: number; r: number; color: string }
  | {
      type: "text";
      content: string;
      font: string;
      fontSize: number;
      x: number;
      y: number;
      w?: number; // optional max width (text condenses to fit)
      color: string;
    };

// A video chain's step, folded onto its track so the renderer applies it per placement; VIDEO_OUT is the sink.
export interface VideoPluginDoc {
  id: string; // "<trackId>:<stepIndex>" — the engine/renderer's per-instance key
  type: "video_effect" | "video_transition"; // mirrors the module's `type`
  name: string; // the module folder name (modules/video_effects/<name>/module.yaml)
  enabled: boolean; // chain step `enabled`; false == bypassed by the renderer
  params: Record<string, number>;
}
// A video-mode lane: "video" links picture and places it at (x,y,w,h), "shape" draws
// parametric shapes. Never reaches the C++ engine (see withoutVideo) — @studio/ui-eyes
// is the only consumer. Already in project.layers draw order.
export interface VideoTrackDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean; // hidden
  kind: "video" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  clips: VideoClipDoc[]; // "video" tracks only
  shapes: ShapeDoc[]; // "shape" tracks only
  plugins?: VideoPluginDoc[]; // modelled but not compiled yet — the video-chain -> renderer path
  // No audio link: an AUDIO track's `video_source` inherits these placements, already resolved into its clips by now.
}

export interface ProjectDoc {
  uuid?: string; // stable song id, generated on first `pistes export`; absent until then
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

  // --- picture (stripped before the engine, see withoutVideo) ---------------
  video: boolean;
  viewport: [number, number]; // px the video tracks draw into; [0,0] when video is off
  fps: number; // frame-by-frame export only (realtime follows the engine clock); default 30
  videoTracks: VideoTrackDoc[]; // ALREADY in project.layers draw order — no consumer re-sorts

  markers: Marker[]; // sorted by beat
  settings: SettingsDoc; // always present, defaulted when settings.yaml is absent
}
