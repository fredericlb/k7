// model.ts — the neutral song shape every importer produces and emit.ts consumes. It is
// deliberately NOT any one foreign format's model: `dawproject.ts` and `ableton.ts` both
// project onto it, which is what lets the ~1300 lines downstream stay format-blind.
// Mirrors st0's song schema (packages/song/src/project.ts). See docs/import.md.

export interface NoteOut {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  vel: number; // 0..1
  channel: number;
  rel: number; // release velocity 0..1
}

export interface ClipOut {
  type: "audio" | "midi";
  name?: string;
  source?: string; // audio only: relative path e.g. "audio/foo.wav"
  start: number; // beats, arrangement position
  length: number; // beats
  offset?: number; // audio: source in-point (beats); midi: playStart
  fadeIn?: number; // beats
  fadeOut?: number; // beats
  loopStart?: number; // midi
  loopEnd?: number; // midi
  notes?: NoteOut[]; // midi only
  warp?: WarpOut; // audio only: time-stretch / warp settings
}

// A clip's warp: `markers` maps a TIMELINE beat to a SOURCE second, two being a linear stretch and more
// piecewise. Times are (beats, seconds) — the only combination this project uses. DAWproject spells this
// <Warps time contentTime>, Ableton <WarpMarker BeatTime SecTime>; both land here unchanged.
export interface WarpOut {
  algorithm?: string;
  markers: [number, number][]; // [timeline beat, source second]
}

export interface SendOut {
  to: string; // resolved destination track id
  level: number;
  enabled: boolean;
}

export interface PluginOut {
  type: string; // "builtin" | "vst3" | "vst2" | "clap" | "au" ...
  name: string;
  role?: string; // "instrument" | "audioFX" | "noteFX"
  enabled: boolean;
  path?: string; // relative path to a preset/state, if any
  params?: Record<string, number>; // text param dump (paramID -> value), filled by the engine-backed resolver
  paramsComplete?: boolean; // true when `params` fully capture the state -> the opaque preset can be dropped
}

export interface TrackOut {
  id: string;
  name: string;
  role?: string; // "regular" | "effect" | "master"
  contentType?: string; // "audio" | "notes" | "audio notes"
  color?: string;
  volume?: number; // linear
  pan?: number; // 0..1 normalized
  mute?: boolean;
  plugins?: PluginOut[];
  sends?: SendOut[];
  clips?: ClipOut[];
}

export interface Song {
  project: {
    name: string;
    tempo: number;
    sampleRate: number;
    timeSignature: string;
  };
  tracks: TrackOut[];
}

export interface Translation {
  song: Song;
  files: Record<string, Uint8Array>; // asset entries to write (audio/*, plugins/*)
  stats: {
    tracks: number;
    audioClips: number;
    midiClips: number;
    notes: number;
    assets: number;
  };
  warnings: string[]; // what the mapper couldn't carry, surfaced in the import log
}
