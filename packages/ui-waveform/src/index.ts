// @studio/ui-waveform — the shared dB-scale waveform canvas: envelope
// rendering, playhead, seek/select drag, marker pins and an optional bar/beat
// grid. Host-agnostic; import "@studio/ui-waveform/styles.css" for the
// wrapper/marker styles.

export {
  BAND_COLOURS,
  type Bands,
  bandsAt,
  type Column,
  columnColour,
  columnsOf,
  PLAIN,
  spectrumColumns,
} from "./spectrum";
export {
  LABEL_GAP_PX,
  labelled,
  labelMinPx,
  labelStride,
  MAX_COLUMN_PX,
  MAX_GRID_SPLIT,
  MIN_LABEL_PX,
  MONO_CHAR_PX,
  nearestTick,
  subdivideBeats,
  subdivideGrid,
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
