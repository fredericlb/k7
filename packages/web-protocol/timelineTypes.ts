// timelineTypes.ts — the compiled song as the frontend draws it: the timeline (beats) and the
// picture (seconds), two documents read off one folder, and the compile's diagnostics.
// Re-exported by types.ts, which is what every consumer imports.

// --- Timeline: the compiled, flat project (mirrors the brain's ProjectDoc) ------

// Compiled by the backend, so the Timeline knows nothing about chains or modules — see docs/document.md.

export interface WebNote {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  // 0..1 as the file states it (NoteSchema's `v`); ABSENT means the schema's default of 1, and dragging back to full clears the field.
  vel?: number;
  // A pad's two effects UNREALISED, drawn as an icon and expanded by the engine — see packages/song/docs/padEffects.md.
  repeat?: number;
  skip?: number;
}
export interface WebClip {
  id: string;
  type: "audio" | "midi";
  name: string;
  start: number; // beats
  length: number; // beats (0 == natural)
  /** WHICH part of the source this placement draws, all three optional — see docs/document.md. */
  offset?: number; // audio: seconds into the source; midi: playStart (beats)
  sourceFrom?: number;
  sourceTo?: number;
  // The audio file's NAME, never its path — enough to tell that a bounce repointed the clip; see docs/document.md.
  sourceName?: string;
  // A clip-relative loop [loopStart, loopEnd) in beats, repeated to fill `length`; absent or both 0 == no loop.
  loopStart?: number;
  loopEnd?: number;
  // The clip is time-stretched: just the fact (markers stay engine-side), so the timeline can flag it.
  warped?: boolean;
  // …and THIS event declines that map (`event status warp`); both are sent, since `warped` alone cannot tell it from "never stretched".
  warpOff?: boolean;
  // Placed but silenced — the event-level `mute`. Still drawn dimmed; the ENGINE is what skips it.
  disabled?: boolean;
  /** How long this event fades in and out, IN BEATS; absent means no fade — see docs/document.md. */
  fadeIn?: number;
  fadeOut?: number;
  /** This clip is a RENDER standing in for a frozen lane, and cannot be edited — see packages/song/docs/freeze.md. */
  frozen?: boolean;
  /** What the PLACEMENT itself said, unmerged — read by clipboard.ts and the takes view; see docs/document.md. */
  event?: WebEvent;
  /** A PIECE of a comped event: the event's own clip id, and the take it plays (@studio/song docs/takes.md). */
  comp?: { of: string; take: string };
  /** A COMPED event, drawn as one clip: the pieces it plays, each a clip of its own on the song's time. */
  pieces?: WebClip[];
  /** Which of its fades is half of a crossfade with a neighbour — drawn as one, heard as equal power. */
  crossfade?: { in?: boolean; out?: boolean };
  notes: WebNote[]; // midi only
}

/** A placement's own fields, as authored — mirrors `EventDoc` in @studio/engine-protocol. */
export interface WebEvent {
  from?: number | string;
  to?: number | string;
  fadeIn?: string;
  fadeOut?: string;
  loop?: number;
  gain?: number; // dB, audio events only — the clip panel's slider
  disabled?: boolean;
  warp?: boolean;
  /** The event's other performances and which plays where, song positions as the file writes them (song docs/takes.md). */
  takes?: { ref: string; start: string }[];
  comp?: { take: string; from: string; to: string }[];
  crossfades?: { at: string; length: string }[];
}

// A downsampled waveform for one audio clip plus the bar/beat grid aligning it — for the audio-clip editor.
export interface WebWaveformGrid {
  t: number; // seconds from the region start
  bar: boolean; // a bar boundary (vs. a plain beat)
  label?: string; // bar number, on bar boundaries
}
// A warp marker in seconds from the region start: `orig` where the point is drawn, `target` where its beat lands.
export interface WebWarpMark {
  orig: number;
  target: number;
  /** The FILE second this point pins, which a surface cannot invert from two numbers — see docs/document.md. */
  src: number;
}
export interface WebWaveform {
  rms: number[]; // 0..1 linear per bucket (feeds the recorder Waveform's dB envelope)
  peak: number[]; // 0..1 per bucket
  /** The three band peaks in `peak`'s buckets, for the spectrum look; absent on a sidecar analysed without them. */
  low?: number[];
  mid?: number[];
  high?: number[];
  seconds: number; // duration of the shown region
  intervalMs: number; // seconds / rms.length * 1000 (envelope sample spacing)
  startBeat: number; // the clip's start in the arrangement
  clipBeats: number; // beats the region spans
  grid: WebWaveformGrid[];
  warpMarks: WebWarpMark[]; // stretch markers, in region seconds (empty == not warped)
  /** `display = (file − inPoint) × stretch` — the mapping a GESTURE has to go back through; see docs/document.md. */
  sourceMap: { inPoint: number; stretch: number; zeroBeat: number };
  /** The span of the source this clip IS, sent only when the picture is WIDER than it — see docs/document.md. */
  sourceWindow?: { from: number; to: number };
  // Display seconds where the onsets ARE, corrections applied — the one list every surface agrees on.
  transients: number[];
  // The same list before corrections, and the corrections themselves, in FILE seconds — see docs/document.md.
  detected?: number[];
  onsetEdits?: { added?: number[]; removed?: number[] };
}

// Audition one sample through the engine: a media path, a clip id, or a slice window in seconds into a source.
export type PreviewReq =
  | { kind: "source"; source: string }
  | { kind: "clip"; clip: string }
  | { kind: "slice"; source: string; from: number; to: number };

// A plugin's FACTORY preset, shaped by the engine that discovers it.
export type { PresetInfo } from "@studio/engine-protocol";

// Progress of the background waveform prewarm (for the status-line spinner).
export interface WaveformStatus {
  warming: boolean;
  done: number;
  total: number;
}
export interface WebPlugin {
  id: string;
  type: string; // xmlTypeName / format
  name: string;
  // An SFZ instrument's file as the module names it: an `@instruments/…` one is asked of the ENGINE, which alone knows if it is there.
  sfzFile?: string;
}
// One track's strip, read off the mixer module at the end of its chain; the tone bands left it — see docs/document.md.
export interface WebMixer {
  module: string;
  volume: number;
  pan: number;
}
export interface WebTrack {
  id: string;
  name: string;
  // The group track this belongs to ('' == none). A group holds no material, so it never appears as a track itself.
  group: string;
  // A lane a group's algo/ pattern streams onto: nothing can be authored there, `clips` is only the look-ahead.
  generated: boolean;
  // What the track HOLDS ("audio" | "notes" | "audio notes") — the timeline uses it to refuse an illegal clip drop.
  contentType: string;
  // Authored track colour ('' == none): a swatch on the label, and the fill of this track's clips.
  color: string;
  // The strip at the end of this track's chain; absent means NO strip — not "at unity" — see docs/document.md.
  mixer?: WebMixer;
  mute: boolean;
  solo: boolean;
  /** Highlighted from the mixer: heard 10 dB up, its fader untouched (packages/song/docs/highlight.md). */
  highlight?: boolean;
  disabled?: boolean; // true ⇒ track is ignored (filtered by the brain); absent when false
  clips: WebClip[];
  /** A FROZEN lane's authored clips, drawn over its render and opened from it — see packages/song/docs/freeze.md. */
  frozenMaterial?: WebClip[];
  plugins: WebPlugin[];
  // `docs`/`todos`, `frozen`, `alternatives` and `alternative` all left this type — see docs/document.md.
}
// A group track (mirrors GroupDoc): clipless, drawn as a header with its member tracks indented under it.
export interface WebGroup {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}
// A video clip: every time here is SECONDS, picture being cut against the wall clock — apps/k7/frontend/docs/picture.md.
export interface WebVideoClip {
  id: string;
  name: string;
  src: string; // workspace-relative media path
  /** A browser-decodable copy at full resolution, read instead of `src` by preview and export (song-video/docs/media.md). */
  optimized?: string;
  /** …and a small one for the preview alone. */
  proxy?: string;
  /** An IMAGE, held while the shot is on (song-video/docs/media.md). */
  still?: true;
  start: number; // seconds
  length: number; // seconds (0 == natural)
  sourceFrom: number; // seconds into the source
  fadeIn?: WebVideoFade;
  fadeOut?: WebVideoFade;
  /** How the shot moves in its lane's frame: each property's keys, sorted, in seconds from its start (song-video/docs/animation.md). */
  animate?: WebVideoAnimate;
  /** How fast the source runs under the shot, signed; absent is 1 (song-video/docs/speed.md). */
  speed?: number;
  /** The run this shot alone goes through, by head node — a key of `stretches` (song-video/docs/effects.md). */
  effect?: string;
  /** A subtitle clip's cues and style (mirrors CaptionsDoc, song-video/docs/titles.md). */
  captions?: {
    cues: { start: number; end: number; text: string }[];
    style: {
      font?: string;
      fontSize?: number;
      color?: string;
      background?: string;
      align?: "left" | "center" | "right";
      position?: "bottom" | "top" | "middle";
      margin?: number;
    };
  };
}
/** One keyframe as the compile normalised it; `ease` shapes the segment LEAVING it. */
export interface WebVideoKey {
  t: number;
  v: number;
  ease: string;
}
/** A shot's animated properties — x, y, scale, opacity, rotate — each its keys. */
export type WebVideoAnimate = Partial<
  Record<"x" | "y" | "scale" | "opacity" | "rotate", WebVideoKey[]>
>;
/** A transition ON a placement (mirrors VideoFadeDoc): how long, and which kind — song-video/docs/transitions.md. */
export interface WebVideoFade {
  over: number; // seconds
  with: string; // a modules/video_transitions/ name, "dissolve", or "over"
  /** The STRETCH the shot runs through over the fade — a key of `WebVideoProject.stretches`. */
  chain?: string;
}
/** A transition's two stages (mirrors VideoTransitionDoc), keyed by NAME on the project — its GLSL rides inline. */
export interface WebVideoTransition {
  name: string;
  vertex: string;
  fragment: string;
  params: Record<string, number>;
}
/** A shape module (mirrors ShapeDoc), geometry in px; `id` is the NODE that draws it — packages/song-video/docs/shapes.md. */
export type WebShape =
  | {
      id: string;
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      type: "circle";
      x: number;
      y: number;
      r: number;
      color: string;
    }
  | {
      id: string;
      type: "text";
      content: string;
      font: string;
      fontSize: number;
      x: number;
      y: number;
      w?: number;
      color: string;
      align?: "left" | "center" | "right"; // how its lines sit in `w`, or about `x` with none
      background?: string; // a box behind the lines, any CSS colour
      shadow?: boolean; // a soft shadow under the glyphs, for text over a picture
      lineHeight?: number; // a multiple of the font size; 1.2 unsaid
      padding?: number; // px between the lines and their box
    };
/** One pass over the picture (mirrors VideoPluginDoc); its GLSL rides inline and `audioFrom` names a lane — see docs/document.md. */
export interface WebVideoPlugin {
  id: string;
  // No `video_transition`: one is NAMED by a cut and never wired — song-video/docs/transitions.md.
  type: "video_effect" | "shader";
  name: string;
  enabled: boolean;
  params: Record<string, number>;
  shader?: { name: string; vertex: string; fragment: string };
  audioFrom?: string;
  /** The `.cube` LUT the shader reads, workspace-relative (song-video/docs/effects.md). */
  lut?: string;
}
/** A video lane (mirrors VideoTrackDoc): picture, a lens, or the `shapes` wired to it; in draw order, bottom first. */
export interface WebVideoTrack {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  /** Soloed, off `project.yaml`'s `soloed:` — the same list audio reads (packages/song-video/docs/picture.md). */
  solo: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  clips: WebVideoClip[];
  shapes: WebShape[];
  // This lane's own run, applied to the layer BEFORE it is composited; absent on a lane no run starts at.
  plugins?: WebVideoPlugin[];
  /** The camera LABEL feeding this lane instead of its placements, "" for the machine's default — packages/song/docs/camera.md. */
  camera?: string;
  /** …and WHEN that lens opens: `off` never, `auto` while the lane is armed, `on` always. */
  cameraMonitor?: "off" | "auto" | "on";
}

// A named timeline marker: `beat` is its position, `tc` the timecode it is stored under (the delete key).
export interface WebMarker {
  beat: number;
  name: string;
  tc: string;
}

export interface WebProject {
  name: string;
  tempo: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  // The song's OUTPUT level in dB, 0 unity and +6 the top of the fader — packages/song/docs/masterVolume.md.
  masterVolume: number;
  tracks: WebTrack[];
  groups: WebGroup[];
  // The metronome enable from settings.yaml — the header button's source of truth; toggling rewrites the file.
  metronome: boolean;
  // …and how loud it clicks, 0.2 … 1; never 0, because silence is the flag above (see METRONOME_MIN).
  metronomeLevel: number;
  // Count-in length in BARS from settings.yaml (0 == none); the engine applies the actual pre-roll.
  countIn: number;
  // Named timeline markers, sorted by beat. Empty when the song has none.
  markers: WebMarker[];
}

// --- PICTURE: the same folder, read again ----------------------------------------

// Nothing here is a beat, and it is a separate document for that reason — see docs/document.md.

/** A named point on the picture's ruler. `sec` is its position; `tc` the `m:ss.mmm` it is stored under (the delete key). */
export interface WebVideoMarker {
  sec: number;
  name: string;
  tc: string;
}

export interface WebVideoProject {
  name: string;
  /** The frame the lanes draw into, in px. */
  viewport: [number, number];
  /** Frames per second. Authoritative for EXPORT; realtime follows the transport's own clock. */
  fps: number;
  /** Where the last picture ends, in seconds — what the timeline sizes itself against. 0 when empty. */
  duration: number;
  markers: WebVideoMarker[];
  /** Already in `layers:` draw order, bottom first — no consumer re-sorts. */
  videoTracks: WebVideoTrack[];
  /** The `RENDER -> VIDEO_OUT` run over the composited frame — the picture's `masterPlugins`, empty by default. */
  framePlugins: WebVideoPlugin[];
  /** Every transition a placement NAMES, by name; the built-in dissolve is absent — the renderer owns it. */
  transitions: Record<string, WebVideoTransition>;
  /** Every stretch a fade NAMES, by its head node — the passes a shot runs through on its way in or out. */
  stretches: Record<string, WebVideoPlugin[]>;
}

// --- Project errors: whether the project even compiles --------------------------

// Everything the compile reports, `file` project-relative and line/col 1-based; a superset of what breaks the Timeline.
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  severity?: "error" | "warning"; // "error" (default) draws red; "warning" amber
}
/** A project root written by a newer k7: the levels the "update k7" message names (song-schema docs/formatLevel.md). */
export interface FormatTooNew {
  fileLevel: number;
  buildLevel: number;
}
export interface ProjectErrors {
  errors: string[]; // flat messages — the count badge
  diagnostics: Diagnostic[]; // located, for the editor's inline squiggles
  formatTooNew?: FormatTooNew; // set when the compile refused a newer format, so the UI says "update k7"
}
/** A document route's 400: the compiler's message, plus `code` and the levels when it is a format refusal. */
export interface CompileErrorBody {
  error: string;
  code?: "format-too-new";
  fileLevel?: number;
  buildLevel?: number;
}
