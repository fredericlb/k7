// snap.ts — the grid rule every drag in this app follows, and the modifier that suspends it.
// Pure, because nothing here mounts a component: the arithmetic that decides what lands in a
// file is the part a test can reach. See docs/timeline.md and docs/clipEditors.md.

/**
 * Is this gesture FREE of the grid? Ctrl, held while the pointer moves.
 *
 * Read live off each pointer event rather than at the grab, unlike the step itself: the step is
 * what the gesture MEANS and must not change under your hand, while the modifier is the hand.
 * Press it halfway through a drag and the rest of the drag is free; let go and it snaps again.
 *
 * ⌘ counts too, and only because Ctrl+click IS the right-click on macOS — the gesture would be
 * unreachable there otherwise. Not a second binding to remember: the one that works on the
 * machine you are on.
 */
export const freeSnap = (e: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean => e.ctrlKey || e.metaKey;

/**
 * `v` on the nearest multiple of `step` — or `v` untouched when there is no step.
 *
 * A step of 0 IS the free case, so every call site reads `snapTo(x, free ? 0 : unit)` and the
 * rule is stated once instead of branching at each of them.
 */
export const snapTo = (v: number, step: number): number =>
  step > 0 ? Math.round(v / step) * step : v;

/**
 * How far a clip drag has travelled, in beats: snapped, and never before the song's start.
 *
 * The OFFSET is what snaps, not the resulting position — a take placed by hand at 4:2:2.43 keeps
 * that phase when you move it a bar. The zoom decides how far each step is, not where the grid
 * is. The floor lands on the step for the same reason: a clip at bar 3 dragged hard left would
 * otherwise stop at beat 0, off the grid it had been walking.
 */
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
