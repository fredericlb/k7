// groupGeometry.ts — the one exception to "widgets never overlap": a GROUP frames the widgets that lie
// wholly inside its box. Pure, so the grid editor and AI organize's check apply one rule. docs/builder.md.
// The one thing a reader would get wrong: a group holds nothing — membership is geometry, not nesting.

import type { Widget } from "@studio/song-schema/yaml/moduleSchema";

type Box = Pick<Widget, "col" | "row" | "colSpan" | "rowSpan">;

const span = (n?: number) => Math.max(1, n ?? 1);

/** Whether two boxes share at least one cell. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.col < b.col + span(b.colSpan) &&
  b.col < a.col + span(a.colSpan) &&
  a.row < b.row + span(b.rowSpan) &&
  b.row < a.row + span(a.rowSpan);

/** Whether `inner` lies wholly inside `outer`. */
export const inside = (inner: Box, outer: Box): boolean =>
  inner.col >= outer.col &&
  inner.row >= outer.row &&
  inner.col + span(inner.colSpan) <= outer.col + span(outer.colSpan) &&
  inner.row + span(inner.rowSpan) <= outer.row + span(outer.rowSpan);

/** Whether two widgets COLLIDE: they overlap, unless one is a group wholly framing the other (never two groups). */
export function clash(a: Widget, b: Widget): boolean {
  if (!overlaps(a, b)) return false;
  const ga = a.type === "group";
  const gb = b.type === "group";
  if (ga && !gb) return !inside(b, a);
  if (gb && !ga) return !inside(a, b);
  return true;
}

/** The ids of the widgets `group` frames — every non-group wholly inside its box. */
export function framedBy(
  widgets: Record<string, Widget>,
  group: Widget,
): string[] {
  return Object.entries(widgets)
    .filter(([, w]) => w.type !== "group" && inside(w, group))
    .map(([id]) => id);
}
