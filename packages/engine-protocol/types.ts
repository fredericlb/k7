// The lanes engine wire protocol — the payload SHAPES shared by the two WebSocket
// clients of the C++ engine (the Node one and the browser one), so they can't silently
// drift. Types only: the message-type strings stay in each client, since every surface
// implements its own subset and the engine itself is the authority on the full contract.
// Being type-only, the whole module is erased at runtime and costs nothing to share.

// A live engine state frame — the ~20 Hz meter/transport push.
export interface EngineState {
  playing: boolean;
  playhead: number; // seconds
  levels: number[]; // per-track OUTPUT dB (post-fader), same index order as the tracks
  // Per-track live INPUT level in dB, same index order as `levels`; -100 with no input assigned. Only meaningful
  // for record-armed tracks, but sent for every track so a client can index it like `levels`.
  inputLevels: number[];
  // The record-armed track ids: session state the engine owns, so it rides the state frame rather than the doc.
  armed: string[];
  // The global record enable: armed tracks record only while this is on AND rolling. Session state, like `armed`.
  recordEnabled: boolean;
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

// A live plugin's parameters by display name. Two messages carry this shape and are NOT interchangeable:
// plugin-params is the state to PERSIST, plugin-params-live the display feed for a watched plugin, pushed while
// a value moves and never to be written. Separate types, so a persisting consumer can't get the live one.
export interface ParamMeta {
  min: number;
  max: number;
  def?: number;
  // A DISCRETE parameter's named settings, in order; absent when continuous, or when the states have no names.
  // Each carries the value that selects it, which is NOT index/(n-1) in general — send it back as given.
  states?: { label: string; value: number }[];
}

export interface PluginParams {
  id: string; // the PluginDoc id (chain:module)
  params: Record<string, number>;
  // Only on the reply to `get-plugin-params`: a range can't change while loaded, so re-sending it 20×/s is waste.
  meta?: Record<string, ParamMeta>;
}
