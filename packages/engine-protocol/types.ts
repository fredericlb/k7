// The st0 engine wire protocol — the payload SHAPES shared by the two WebSocket
// clients of the C++ engine (the Node one and the browser one), so they can't silently
// drift. Types only: the message-type strings stay in each client, since every surface
// implements its own subset and the engine itself is the authority on the full contract.
// Being type-only, this module and ./project are erased at runtime and cost nothing to
// share. ./build is the exception — constructors, so it emits code.

// A live engine state frame — the ~20 Hz meter/transport push.
export interface EngineState {
  // WHICH project this frame describes; optional because an engine older than sessions stamps nothing — see docs/sessions.md.
  session?: string;
  playing: boolean;
  playhead: number; // seconds
  // The transport loop the engine wraps in, in seconds — absent from an engine older than it; a reloaded page draws it from here.
  loop?: { on: boolean; start: number; end: number };
  levels: number[]; // per-track OUTPUT dB (post-fader), same index order as the tracks
  // Per-track live INPUT level in dB, sent for every track so a client can index it like `levels`; -100 with no input assigned.
  inputLevels: number[];
  // The record-armed track ids: session state the engine owns, so it rides the state frame rather than the doc.
  armed: string[];
  // This session's record enable: its armed tracks record only while this is on AND rolling.
  recordEnabled: boolean;
  /** The MASTER output in dB (-100 == silent) — one number for the whole song, read off a level-meter plugin on the master list. */
  master: number;
  /** Whether the master went over full scale since the last frame, from the meter's LATCHED peak rather than this 20 Hz sample. */
  masterClipped: boolean;
  // Per-module waveform envelopes keyed "chain:module:side", sampled at the state-frame rate; empty with no taps.
  waveform: Record<string, WaveformEnvelope[]>;
  /** Each PLATTER's needle in seconds of its OWN record, by plugin id — `playhead` is not its clock. */
  platters?: Record<string, number>;
  /** Each RECORDER node, by plugin id — absent when the project declares none. */
  recorders?: Record<string, RecorderState>;
  /** What things COST, on one frame in four — absent on the others, which keep the last. engine docs/load.md. */
  load?: EngineLoad;
}

/** Every plugin's cost and the engine's own memory, as one state frame reports them. */
export interface EngineLoad {
  plugins: Record<string, PluginLoad>;
  /** The engine process's memory in bytes, as its OS counts it; absent where the platform will not say. */
  process?: number;
}

/** One plugin's cost. */
export interface PluginLoad {
  /** Its share of an audio block's time, 0..1 — audio-thread work only, not its own threads'. */
  cpu: number;
  /** The bytes it says it holds, from our own plugins only; absent for one that cannot say. */
  bytes?: number;
}

/** One take a recorder node finished: where the engine wrote it, and what it cost. */
export interface RecorderTake {
  /** ABSOLUTE, on the engine's machine — the file service is what reads it, and it runs there. */
  file: string;
  seconds: number;
  /** The ring lapped: frames are MISSING from this file. Reported rather than left to be noticed. */
  damaged?: boolean;
}

/** One recorder node as the state frame reports it — free-running, so none of this is transport. */
export interface RecorderState {
  recording: boolean;
  /** The take being written; 0 when idle. */
  seconds: number;
  /** Oldest first, so the last one is what `clear` pops. */
  takes: RecorderTake[];
  /** Points made SINCE THE LAST FRAME. The client APPENDS them — see engine docs/recorder.md. */
  envelope: WaveformEnvelope[];
  /** Where those points START in the take. Normally the count the client already holds — but the
   *  engine rewinds it to 0 for a socket that just connected, which is how a RELOAD gets the whole
   *  picture instead of a take that looks like it began at the reload. */
  from: number;
}

// One min/max envelope point, covering a bucket of N samples (256 at 44.1 kHz ≈ 5.8 ms), normalised -1..1.
export interface WaveformEnvelope {
  min: number;
  max: number;
}

// The bare transport verbs both clients send. A positioned "seek" carries a field, so it goes as its own message.
// `panic` is a transport verb because it is what a STOP that did not work asks for next — see
// engine/st0-engine/docs/panic.md.
export type TransportAction = "play" | "stop" | "toggle" | "rewind" | "panic";

// A live plugin's parameters by display name; `plugin-params` is the state to PERSIST and `plugin-params-live` the display feed, never written.
export interface ParamMeta {
  min: number;
  max: number;
  def?: number;
  // A DISCRETE parameter's named settings, each carrying the value that selects it — NOT index/(n-1), so send it back as given.
  states?: { label: string; value: number }[];
}

export interface PluginParams {
  id: string; // the PluginDoc id (chain:module)
  params: Record<string, number>;
  // Only on the reply to `get-plugin-params`: a range can't change while loaded, so re-sending it 20×/s is waste.
  meta?: Record<string, ParamMeta>;
}

// A selectable module preset, discovered by the ENGINE in the plugin or authored by the user, so the shape is the engine's.
export interface PresetInfo {
  name: string;
  source: "program" | "file" | "user";
  index: number; // program-list index (source "program"), else -1
  path: string; // absolute preset path (source "file" | "user"), else ""
}
