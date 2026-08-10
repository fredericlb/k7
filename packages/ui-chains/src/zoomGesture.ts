// zoomGesture.ts — how much one wheel event zooms the graph, and why a trackpad pinch cannot
// share a wheel notch's answer. Here rather than in the renderer because it is a decision with a
// right and a wrong answer, and this is the half of the graph that has tests.

/** Below this the graph is a map; above it, a workbench. Both ends are the renderer's. */
export const WHEEL_CLAMP = 50;

/**
 * The factor one wheel event multiplies the zoom by.
 *
 * A mouse wheel arrives as ONE event per detent, with a delta in the hundreds; `0.001` turns
 * that into a comfortable ~10% a notch. A trackpad PINCH arrives as Ctrl+wheel — a stream of
 * small continuous deltas, dozens a second — where that same coefficient gives a fraction of a
 * percent each, which is the "very slow" you feel with two fingers. Ten times the coefficient
 * makes a pinch track the fingers and leaves the wheel exactly as it was.
 *
 * The pinch delta is CLAMPED first: browsers disagree about the units they report a pinch in,
 * and one that answers in hundreds would jump a decade in a single event.
 */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
  if (!pinch) return Math.exp(-deltaY * 0.001);
  const d = Math.max(-WHEEL_CLAMP, Math.min(WHEEL_CLAMP, deltaY));
  return Math.exp(-d * 0.01);
}

/**
 * Two fingers: the factor for a spread, measured against the spread the gesture STARTED at.
 *
 * Against the start and not the previous frame, because a ratio of ratios accumulates rounding —
 * pinch out and back in, and you would not return where you began. A zero or negative spread is
 * not a gesture; it answers 1 rather than a division by zero.
 */
export function pinchFactor(startSpread: number, spread: number): number {
  return startSpread > 0 && spread > 0 ? spread / startSpread : 1;
}

/** The distance between two touch points — what a pinch is measured in. */
export function spreadOf(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
