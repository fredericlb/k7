// The shapes the Waveform canvas reads. Deliberately structural and
// app-neutral — each host passes its own richer domain objects straight
// through (k7's annotations/markers, k7's clip grid).

/** A level envelope: linear RMS samples (1.0 == full scale) every intervalMs. */
export interface Envelope {
  intervalMs: number;
  /** Per-bucket RMS, 0..1 linear where 1.0 is full scale. The contour drawn solid. */
  samples: number[];
  /** Per-bucket PEAK on the same axis, drawn faintly behind `samples`; optional, and why there are two — docs/envelopes.md. */
  peak?: number[];
  /** The three band peaks in the same buckets, which the `spectrum` look colours by; optional — docs/spectrum.md. */
  low?: number[];
  mid?: number[];
  high?: number[];
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

// A vertical gridline at time `t` in seconds: `bar` draws it stronger, `label` is printed near the top.
export interface WaveformGrid {
  t: number;
  bar: boolean;
  label?: string;
}
