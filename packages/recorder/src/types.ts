// k7's domain types as the recorder components consume them, re-exported
// alongside Selection (owned by @studio/ui-waveform) and the recorder-only
// Metronome that lives here.

export type {
  DetectedEvent,
  Envelope,
  Session,
} from "@studio/rehearsal-shared";
export type { Selection } from "@studio/ui-waveform";

/** A running metronome: tempo plus the waveform-timeline position it started at. */
export interface Metronome {
  bpm: number;
  startSec: number;
}
