// lanes.ts — the geometry an arrangement is drawn to. Constants rather than each app's own
// numbers, because the gutter width is what a caret's "left of the first beat" test compares
// against and what useHZoom's anchor maths subtracts: two surfaces disagreeing about it is a
// click landing one column off, which reads as a rounding bug and is not one.

/** The fixed, non-scaling left column holding a lane's name. Wide enough for a name plus a mute/solo pair. */
export const GUTTER_DESKTOP = 140;
/** The same column where there is no room for the controls — the name alone. */
export const GUTTER_MOBILE = 84;

/** One lane's height, in px. Rows are uniform: a taller lane would make "which row is at y" a search. */
export const ROW_H = 28;

/** The ruler's height, above the first lane. */
export const RULER_H = 22;

/** Marker lines and their labels — electric blue, the one colour in these views that means "a place you named". */
export const MARKER_COLOR = "#2f9bff";

/**
 * Hatching for a lane that cannot hold a clip — a group header, a generated lane.
 *
 * A CSS gradient because neither surface has an SVG layer, and `currentColor` so the lane
 * picks the stripe colour with a text-* class rather than this string knowing any palette.
 */
export const HATCH =
  "repeating-linear-gradient(45deg, transparent 0 4px, currentColor 4px 5px)";

/** Where `value` sits in px, given the gutter and the scale. The one conversion both directions use. */
export function xOf(value: number, pxPerUnit: number, gutter: number): number {
  return gutter + value * pxPerUnit;
}

/** The inverse: what a page x means on the lane. Negative before the first tick, which callers test for. */
export function valueAt(x: number, pxPerUnit: number, gutter: number): number {
  return pxPerUnit > 0 ? (x - gutter) / pxPerUnit : 0;
}
