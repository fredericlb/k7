// project.ts — the compiled project the engine plays: the ProjectDoc tree, exactly as it
// goes on the wire. Types only, like the state frames beside it, so the C++ mirror in
// engine/ProjectDoc.h has one TypeScript counterpart and no more.
//
// This is NOT "a st0 song". It is the OUTPUT of a compiler, and any app that can build
// one can drive the engine — pl8's module preview is a one-track doc, a DJ deck
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
  /** How loud the click is, 0.2 … 1 (`settings.yaml`'s `metronome_level`); never 0, because silencing it is `metronome: false`. */
  metronomeLevel: number;
  countIn: number; // BARS the transport rolls before an armed track records; 0 == immediately
}

export interface NoteDoc {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  vel: number; // 0..1
  channel: number;
  rel: number; // release velocity 0..1
  /** A step sequencer PAD's two effects, carried UNREALISED and expanded by the ENGINE — see @studio/song docs/padEffects.md. */
  repeat?: number;
  skip?: number;
}

// Time-stretch for an audio clip: two markers is a linear stretch, more is piecewise (Tracktion's WarpTimeManager).
export interface WarpDoc {
  algorithm: string; // the stretch engine, e.g. "elastique" | "slice"
  markers: [number, number][]; // [timeline beat, source second]
}

/** A placement's OWN words as AUTHORED, unmerged, for the surface that writes them back out — see apps/st0/frontend/docs/clipEditors.md. */
export interface EventDoc {
  from?: number | string; // seconds into a clip's file, or a timecode into a sequence's notes
  to?: number | string;
  fadeIn?: string; // a timecode, as the file writes it
  fadeOut?: string;
  loop?: number; // passes; absent == 1
  disabled?: boolean;
  warp?: boolean; // `false` == this event declines the material's stretch map
}

export interface ClipDoc {
  id: string;
  type: "audio" | "midi";
  name: string;
  source: string; // audio: absolute path once loaded; midi: ''
  start: number; // beats
  length: number; // beats, 0 == natural length
  offset: number; // audio: source in-point; midi: playStart (beats)
  // The clip file's own window into its SOURCE, in seconds because it measures into a file; absent on a clip the compiler synthesised.
  sourceFrom?: number; // seconds into the file; absent == from its start
  sourceTo?: number; // seconds into the file; absent == to its end
  fadeIn: number; // beats
  fadeOut: number; // beats
  loopStart: number; // midi (beats)
  loopEnd: number; // midi (beats); 0 == no loop
  notes: NoteDoc[]; // midi only
  warp?: WarpDoc; // audio only: time-stretch settings, when the clip carries a `warp`
  /** The clip HAS a stretch map and this event declines it; carried for the timeline, which draws the stretch icon crossed. */
  warpOff?: boolean;
  // Silenced without being removed, and carried rather than filtered out because the timeline still has to DRAW it.
  disabled?: boolean;
  // What the placement itself said, unmerged, for anything that has to write it out again.
  event?: EventDoc;
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
  namFile?: string; // amp modules only: the `model:` file, a .nam or an RTNeural JSON — see irFile
  sfzFile?: string; // SFZ instruments only: `@instruments/<name>/<file>.sfz`, on the engine's machine (engine docs/sfzPlugin.md)
  // TURNTABLE modules only — the record the platter OWNS, decoded whole so a scratch can read it backwards.
  deckFile?: string;
  // A DSP-graph module's description, INLINE as JSON because the engine parses no files and the plugin's constructor needs it.
  dspGraph?: string;
  // A Faust module's source, INLINE for the same reason — except the ENGINE compiles it, so the `.dsp` text itself travels.
  faustDsp?: string;
  // A PATTERN lane's Strudel source, played by the engine's PatternPlugin; an edit is applied in place.
  patternSource?: string;
  // …the label its events are picked by — the lane's name, matched like a `.label()` slug…
  patternLabel?: string;
  // …whether it also takes the file's unlabelled events and the labels no lane claims, and which labels are claimed…
  patternCatchAll?: boolean;
  patternClaimed?: string[];
  // …what it plays: a bare lane both, a split one its notes on `#midi` and its samples on `#audio`…
  patternPlays?: "notes" | "samples" | "both";
  // …whether it is the lane's only one, so what it cannot play is played nowhere and is said so…
  patternOnly?: boolean;
  // …and where a sound name is looked for as a sample, in order.
  patternBanks?: string[];
  // The TRACK id feeding this module's SECOND input port (@studio/song docs/ports.md); absent when unwired, which is legitimate.
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
  // No volume and no pan: they are a MODULE (MixerPlugin) at the end of each chain, while mute and solo are mixer-wide.
  mute: boolean;
  solo: boolean;
  disabled: boolean;
  inputChannels: number[]; // 1-based physical channels; a label is resolved against ~/.st0 first, so the engine only ever sees numbers
  // Where this track LEAVES by. Empty is the mixer's sum, which is every track but a CUE bus — packages/song/docs/cue.md.
  outputChannels: number[]; // 1-based physical channels, resolved the same way and for the same reason
  monitor: string; // Tracktion's "off" | "auto" (armed) | "on"; ignored when inputChannels is empty
  inputGain: number; // interface input trim in dB, 0 == unity; ignored when inputChannels is empty
  clips: ClipDoc[];
  // A FROZEN lane's authored clips, which its render replaced in `clips` — for the browser to draw; the engine ignores it.
  frozenMaterial?: ClipDoc[];
  plugins: PluginDoc[];
  sends: SendDoc[];
  automation: AutomationDoc[];
}

// A group track: it holds no material, so the engine plays no lane for it, but surfaces draw it over its members.
export interface GroupDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}

// PICTURE IS NOT HERE: it is a SECOND compile of the same song folder, which keeps the frame off this wire — packages/song/docs/picture.md.

export interface ProjectDoc {
  uuid?: string; // stable song id, generated on first `st0 export`; absent until then
  name: string;
  tempo: number;
  sampleRate: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  /** The song's output level in dB on the master fader, 0 unity and +6 the ceiling; always sent, because the engine DIFFS documents. */
  masterVolume: number;
  /** The MASTER CHAIN — plugins over the summed mix, before the meter and `masterVolume`; always sent, for the same diffing reason. */
  masterPlugins: PluginDoc[];
  // Where a live take lands ('' for a single-file song, which the engine refuses to arm) — the ONE path it is told.
  recordDir: string;
  tracks: TrackDoc[];
  groups: GroupDoc[]; // what the tracks' `group` pointers refer to; the engine ignores it
  markers: Marker[]; // sorted by beat
  settings: SettingsDoc; // always present, defaulted when settings.yaml is absent
}
