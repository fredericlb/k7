// zoomGesture.ts — how much one wheel event zooms the graph, and why a trackpad pinch cannot
// share a wheel notch's answer. Here rather than in the renderer because it is a decision with a
// right and a wrong answer, and this is the half of the graph that has tests.

/** Below this the graph is a map; above it, a workbench. Both ends are the renderer's. */
export const WHEEL_CLAMP = 50;

/** The factor one wheel event multiplies the zoom by — a pinch is ten times it. See docs/graphBuild.md. */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
  if (!pinch) return Math.exp(-deltaY * 0.001);
  const d = Math.max(-WHEEL_CLAMP, Math.min(WHEEL_CLAMP, deltaY));
  return Math.exp(-d * 0.01);
}

/** Two fingers: the factor for a spread, measured against the spread the gesture STARTED at. */
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
