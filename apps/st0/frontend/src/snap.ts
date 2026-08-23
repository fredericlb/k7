// snap.ts — the grid rule every drag in this app follows, and the modifier that suspends it.
// Pure, because nothing here mounts a component: the arithmetic that decides what lands in a
// file is the part a test can reach. See docs/timeline.md and docs/clipEditors.md.

/** Is this gesture FREE of the grid? Ctrl read LIVE off each event, unlike the step: the step is what the gesture means, the modifier is the hand. */
export const freeSnap = (e: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean => e.ctrlKey || e.metaKey;

/** `v` on the nearest multiple of `step`, or untouched when there is none — a step of 0 IS the free case, stated once. */
export const snapTo = (v: number, step: number): number =>
  step > 0 ? Math.round(v / step) * step : v;

/** How far a clip drag has travelled, in beats: the OFFSET snaps, not the position, and the floor lands on the step for the same reason. */
export function dragOffset(
  dx: number, // pixels travelled
  ppb: number, // pixels per beat at the grab
  step: number, // beats per grid step, 0 when free
  origStart: number, // where the clip was, so it cannot be dragged before 0
): number {
  const raw = snapTo(dx / Math.max(1e-6, ppb), step);
  const floor = step > 0 ? Math.ceil(-origStart / step) * step : -origStart;
  return Math.max(floor, raw);
}
