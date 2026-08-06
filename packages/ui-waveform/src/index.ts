// @studio/ui-waveform — the shared dB-scale waveform canvas: envelope
// rendering, playhead, seek/select drag, marker pins and an optional bar/beat
// grid. Host-agnostic; import "@studio/ui-waveform/styles.css" for the
// wrapper/marker styles.

export {
  LABEL_GAP_PX,
  labelled,
  labelMinPx,
  labelStride,
  MAX_COLUMN_PX,
  MIN_LABEL_PX,
  MONO_CHAR_PX,
  nearestTick,
  subdivideBeats,
} from "./ticks";
export type {
  Annotation,
  DetectedEvent,
  Envelope,
  Marker,
  Selection,
  WaveformGrid,
} from "./types";
export { Waveform } from "./Waveform";
