// The score package's light half: the toolbar arithmetic. The viewer itself is the separate
// `@k7/score/ScoreView` entry, imported lazily so alphaTab loads only where a score is shown.

export {
  clampTranspose,
  formatTranspose,
  stepZoom,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  ZOOM_STEPS,
} from "./controls.ts";
