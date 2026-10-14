// snap.ts — the grid rule every drag in this app follows, and the modifiers that change it.
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

/** How a MOVE or a RESIZE lands: on the project's grid, a whole number of steps from where it was, or free. */
export type SnapMode = "grid" | "relative" | "free";

/** Read live off each pointer event: Shift frees the gesture, Ctrl keeps the event's own offset from the grid. */
export const snapMode = (e: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): SnapMode =>
  e.shiftKey ? "free" : e.ctrlKey || e.metaKey ? "relative" : "grid";

/** Where a position dragged from `orig` by `delta` beats lands, under `mode`, on a grid of `step` beats. */
export function snapPosition(
  orig: number,
  delta: number,
  step: number,
  mode: SnapMode,
): number {
  if (mode === "free" || step <= 0) return orig + delta;
  if (mode === "relative") return orig + snapTo(delta, step);
  return snapTo(orig + delta, step);
}

/** A clip move's offset in beats under `mode` — never before the song's start. */
export function moveOffset(
  dx: number,
  ppb: number,
  step: number,
  origStart: number,
  mode: SnapMode,
): number {
  const to = snapPosition(origStart, dx / Math.max(1e-6, ppb), step, mode);
  // The song's start is the floor, reached on the grid itself when there is one.
  const floor =
    mode === "relative" && step > 0
      ? origStart + Math.ceil(-origStart / step) * step
      : 0;
  return Math.max(floor, to) - origStart;
}
