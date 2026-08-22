// project.ts — the compiled project the engine plays: the ProjectDoc tree, exactly as it
// goes on the wire. Types only, like the state frames beside it, so the C++ mirror in
// engine/ProjectDoc.h has one TypeScript counterpart and no more.
//
// This is NOT "a st0 song". It is the OUTPUT of a compiler, and any app that can build
// one can drive the engine — pl8's module preview is a one-track doc, an m9 deck
// is two. That is why it lives here and not in @studio/song, which would drag the whole
// YAML compiler in behind it. `@studio/song` re-exports these and owns the code that
// PRODUCES them; `./build` has constructors for callers that have no song folder.

// `ProjectMode` was here — "arrangement" or "live", the shape a folder declared in
// `project.yaml`'s `project_type`. It is gone, and so is `ProjectDoc.mode` below: what a project
// draws is what its `surfaces/` folder says (packages/song/docs/surfaces.md), which is a better
// answer to the same question because it is the one the screen actually reads. The engine never
// looked at either — it is handed tracks and plays them.

// A named timeline marker from project.yaml's `markers` map; `beat` is that timecode in timeline beats.
export interface Marker {
  tc: string; // the map key — a canonical timecode, e.g. "5:1:1"
  name: string;
  beat: number;
}

// Project-level playback/recording settings, carried on every ProjectDoc and defaulted when the file is absent.
export interface SettingsDoc {
  metronome: boolean; // the project's stored click-track default (the engine also has a live toggle)
  /**
   * How loud the click is, 0.2 … 1 — `settings.yaml`'s `metronome_level`.
   *
   * Never 0: silencing the click is `metronome: false`, and this range is Tracktion's own
   * (`Edit::setClickTrackVolume` clamps to it). A level that could reach zero would be a second
   * way to switch it off, and the two would disagree the moment one was set and the other read.
   */
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
  /**
   * A step sequencer PAD's two effects, carried UNREALISED — see @studio/song docs/padEffects.md.
   *
   * `repeat` retriggers the note that many times inside its own duration; `skip` silences it on
   * every Nth pass of the pattern. Both are expanded by the ENGINE (`insertMidiClip`), not by the
   * compiler, and that split is the point: expanding `skip` needs the passes unrolled, and a
   * document with four passes of notes in it is a document the sequencer would draw four times
   * over. The pattern the surface edits and the notes the engine plays are not the same list.
   *
   * It also keeps a render and live playback identical for free, since both build their edit
   * through the same EditBuilder.
   */
  repeat?: number;
  skip?: number;
}

// Time-stretch for an audio clip: two markers is a linear stretch, more is piecewise (Tracktion's WarpTimeManager).
export interface WarpDoc {
  algorithm: string; // the stretch engine, e.g. "elastique" | "slice"
  markers: [number, number][]; // [timeline beat, source second]
}

/**
 * A placement's OWN words, carried through the compiler unmerged — `from`/`to`/`fadeIn`/… exactly
 * as `nodes/<lane>.yaml` spells them, minus the `ref` and `start` every clip states anyway.
 *
 * The rest of `ClipDoc` is the placement and its MATERIAL resolved together, which is what playing
 * it needs and what DUPLICATING it cannot use: `sourceFrom`/`sourceTo` are already the
 * intersection of the two windows, a sequence's window went into `loopStart`/`loopEnd`, and the
 * repeat count was multiplied into `length`. Copying an event off a compiled document therefore
 * lost its trim, its fades and its passes — see apps/st0/frontend/docs/clipEditors.md.
 *
 * The ENGINE has no use for any of it (it is handed the merged answer, as ever) — this is the
 * third fact carried for a SURFACE alone, beside `warpOff` and `disabled`. As AUTHORED rather
 * than normalised, because what reads it writes it straight back out: a window spelled `"2:1"`
 * should come back `"2:1"` and not the seconds it happens to mean at today's tempo.
 */
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
  /**
   * The clip HAS a stretch map and this event declines it (`warp: false` on the placement).
   *
   * `warp` above is already absent when that happens — the engine is handed a document, not a
   * question, and an event that does not warp simply has no map. This is the second fact the
   * ENGINE has no use for and a SURFACE does: the timeline draws the stretch icon crossed, which
   * it could not do from an absence indistinguishable from "never warped".
   */
  warpOff?: boolean;
  // Silenced without being removed — a track's `mute`, at the level of one event. It is
  // carried to the engine rather than filtered out here, because the timeline still has
  // to DRAW it: a disabled event you can't see is a deleted one.
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
  namFile?: string; // amp-modeller modules only (a .nam model) — see irFile
  // A DSP-graph module's description, INLINE as JSON rather than a path: the compiler has already read it, and
  // the engine parses no files. Its parameters come from it, so it must reach the plugin's constructor.
  dspGraph?: string;
  // A Faust module's source, INLINE for the same reason — except that here the engine is what
  // compiles it, so what travels is the `.dsp` text itself rather than something already chewed.
  faustDsp?: string;
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

/**
 * A TAKE: what a lane was playing, set aside when something was recorded over it.
 *
 * The same list of clips a lane holds, compiled the same way — so a surface can draw one without
 * knowing it is looking at a take. **The engine never receives these**: `withoutTakes` strips them
 * at the one place a document is sent (see @studio/song's project.ts). They are compiled here
 * rather than beside the drawing code so that a take's clips get their real extents from the one
 * compiler, and stay identical to the arrangement they were.
 */
export interface TakeDoc {
  name?: string;
  clips: ClipDoc[];
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
  // The lane's takes — absent on a lane with none, and never on the wire (see TakeDoc).
  takes?: TakeDoc[];
  plugins: PluginDoc[];
  sends: SendDoc[];
  automation: AutomationDoc[];
  // `docs` / `todos` were here — authored notes carried through for a panel that listed them.
  // Gone with that panel: a note is a doc module on the graph (`@studio/doc`), which is not a
  // track's business and never reaches the engine. See packages/song/docs/docModules.md.
  // `frozen`, `alternatives` and `alternative` were here, all three ignored by the engine and
  // carried only so a surface could draw them. They are gone with the fields they came from, to
  // be replaced by another mechanism later — see packages/song/docs/trackModules.md.
}

// A group track: it holds no material, so the engine plays no lane for it, but surfaces draw it over its members.
export interface GroupDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}

// PICTURE IS NOT HERE. It belongs to whoever draws it, as @studio/song's videoDoc.ts (compiled)
// and @studio/web-protocol's WebVideoProject (browser) — a SECOND compile of the same song
// folder, which is what keeps the frame out of this one and off the wire. See
// packages/song/docs/picture.md.

export interface ProjectDoc {
  uuid?: string; // stable song id, generated on first `st0 export`; absent until then
  name: string;
  tempo: number;
  sampleRate: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  /**
   * The song's output level in dB, applied to the master fader — 0 is unity.
   *
   * Always sent, defaulted rather than optional, because the engine DIFFS documents: an absent
   * field would read as "unchanged" against a doc that carried one, and a master returned to
   * unity would never come back down. +6 is the ceiling — Tracktion's fader curve, not a policy
   * (see @studio/song's docs/masterVolume.md).
   */
  masterVolume: number;
  // Where a live take lands ('' for a single-file song, which the engine refuses to arm) — the ONE path it is told.
  recordDir: string;
  tracks: TrackDoc[];
  groups: GroupDoc[]; // what the tracks' `group` pointers refer to; the engine ignores it
  strudel: boolean; // whether any track streams from an algo/ pattern — surfaces skip the clock poll when false
  markers: Marker[]; // sorted by beat
  settings: SettingsDoc; // always present, defaulted when settings.yaml is absent
}
