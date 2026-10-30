// The score package's light half: the toolbar arithmetic. The viewer itself is the separate
// `@studio/score/ScoreView` entry, imported lazily so Verovio and the synth load only where a score is shown.

export {
  clampTranspose,
  formatTranspose,
  stepZoom,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  ZOOM_STEPS,
} from "./controls.ts";
