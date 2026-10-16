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

/** `decimate` for a take that only GROWS: points fold into power-of-two buckets as they arrive, so a paint costs the new points, not the take. */
// Between width/2 and width points come out once the take outgrows the canvas: fixed bucket edges are what make an append incremental.
export class GrowingDecimate {
  private src: readonly EnvPoint[] | null = null;
  private width = 0;
  private seen = 0;
  private size = 1;
  private buckets: EnvPoint[] = [];

  /** The picture of `points` in at most `width` buckets; the same array is pushed to while it grows, a new one starts afresh. */
  of(points: readonly EnvPoint[], width: number): readonly EnvPoint[] {
    if (
      points !== this.src ||
      width !== this.width ||
      points.length < this.seen
    ) {
      this.src = points;
      this.width = width;
      this.seen = 0;
      this.size = 1;
      this.buckets = [];
    }
    if (width <= 0) return this.buckets;
    for (let k = this.seen; k < points.length; k++) {
      const p = points[k];
      const b = this.buckets[Math.floor(k / this.size)];
      if (!b) this.buckets.push({ min: p.min, max: p.max });
      else {
        if (p.min < b.min) b.min = p.min;
        if (p.max > b.max) b.max = p.max;
      }
      if (this.buckets.length > width) this.halve();
    }
    this.seen = points.length;
    return this.buckets;
  }

  // Merge each pair of buckets into one twice as wide; the edges stay on multiples of the new size.
  private halve(): void {
    const merged: EnvPoint[] = [];
    for (let i = 0; i < this.buckets.length; i += 2) {
      const a = this.buckets[i];
      const b = this.buckets[i + 1];
      merged.push(
        b ? { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) } : a,
      );
    }
    this.buckets = merged;
    this.size *= 2;
  }
}
