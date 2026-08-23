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
}

// One min/max envelope point, covering a bucket of N samples (256 at 44.1 kHz ≈ 5.8 ms), normalised -1..1.
export interface WaveformEnvelope {
  min: number;
  max: number;
}

// The bare transport verbs both clients send. A positioned "seek" carries a field, so it goes as its own message.
export type TransportAction = "play" | "stop" | "toggle" | "rewind";

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
