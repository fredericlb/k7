// The shapes the Waveform canvas reads. Deliberately structural and
// app-neutral — each host passes its own richer domain objects straight
// through (k7's annotations/markers, pistes's clip grid).

/** A level envelope: linear RMS samples (1.0 == full scale) every intervalMs. */
export interface Envelope {
  intervalMs: number;
  samples: number[];
}

/** A selected time range on the waveform, in seconds. */
export interface Selection {
  start: number;
  end: number;
}

/** A single-timestamp pin drawn on the timeline. */
export interface Marker {
  id: string;
  atSec: number;
  comment?: string;
}

/** A shaded time span (the host's annotation/moment). */
export interface Annotation {
  startSec: number;
  endSec: number;
}

/** A shaded time span produced by loudness detection. */
export interface DetectedEvent {
  startSec: number;
  endSec: number;
}

// A vertical gridline at time `t` (seconds). `bar` draws it stronger; `label`
// (a bar number) is printed near the top. Used to overlay musical bars/beats
// (e.g. pistes's audio-clip editor) — omit for a plain waveform.
export interface WaveformGrid {
  t: number;
  bar: boolean;
  label?: string;
}
