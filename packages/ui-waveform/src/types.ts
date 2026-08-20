// The shapes the Waveform canvas reads. Deliberately structural and
// app-neutral — each host passes its own richer domain objects straight
// through (k7's annotations/markers, st0's clip grid).

/** A level envelope: linear RMS samples (1.0 == full scale) every intervalMs. */
export interface Envelope {
  intervalMs: number;
  /** Per-bucket RMS, 0..1 linear where 1.0 is full scale. The contour drawn solid. */
  samples: number[];
  /**
   * Per-bucket PEAK, on the same axis and the same bucket spacing — drawn faintly BEHIND
   * `samples`, or not at all when absent.
   *
   * Optional because most hosts have only one envelope, and because the pane that has both was
   * drawing the wrong one: RMS on a grid labelled in dBFS reads as a level meter, so a clip
   * normalised to −1 dBFS drew its tallest column around −10 and looked untouched. The two
   * numbers are 9 dB apart on a plucked guitar and further on anything percussive, and only one
   * of them is what a normalise sets.
   *
   * Both, rather than swapping one for the other: the trim gate measures RMS and draws its
   * threshold on this same axis, so a curve that stopped being RMS would leave that line
   * comparing itself to something it does not measure.
   */
  peak?: number[];
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
// (e.g. st0's audio-clip editor) — omit for a plain waveform.
export interface WaveformGrid {
  t: number;
  bar: boolean;
  label?: string;
}
