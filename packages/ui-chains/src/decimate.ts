// decimate.ts — a take's picture down to the pixels there are to draw it in.
//
// Split from the accumulation, which moved to @studio/engine-browser so it could outlive the card
// (packages/song/docs/recorderNode.md). This half stayed: it is about a CANVAS's width and belongs
// beside what draws it.

/** One min/max point, the shape the engine's tap emits. */
export interface EnvPoint {
  min: number;
  max: number;
}

/**
 * Down to `width` points, min and max kept apart — a five-minute take is 3500 points and a card
 * is 120 pixels wide. Decimating by AVERAGING would flatten every peak into the mean and draw a
 * quiet take; a waveform's whole job is the extremes.
 */
export function decimate(
  points: readonly EnvPoint[],
  width: number,
): EnvPoint[] {
  if (width <= 0) return [];
  if (points.length <= width) return [...points];
  const out: EnvPoint[] = [];
  for (let i = 0; i < width; i++) {
    const from = Math.floor((i * points.length) / width);
    const to = Math.max(
      from + 1,
      Math.floor(((i + 1) * points.length) / width),
    );
    let lo = points[from].min;
    let hi = points[from].max;
    for (let j = from + 1; j < to; j++) {
      if (points[j].min < lo) lo = points[j].min;
      if (points[j].max > hi) hi = points[j].max;
    }
    out.push({ min: lo, max: hi });
  }
  return out;
}
