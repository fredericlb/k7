// groupEdge.ts — which widgets share a group's LEFT edge with its name, and how far each is drawn in.
// The inset is drawing only: the file, the grid and the builder's checks keep every widget on its
// cells. The one thing a reader would get wrong: a group holds nothing — membership is geometry.
// Rationale: ui-chains-react's docs/widgets.md, "The group".

import type { WebWidget } from "@studio/graph-model";

/** How far a control on a group's named edge is drawn in: clear of the 6px name and the 8px dot. */
export const GROUP_EDGE_INSET = 12;

/** …and a field there, whose caption is flush left and so meets the name first. */
export const GROUP_FIELD_INSET = 16;

// The widgets drawn as a field: they fill their box's width, so they take the wider inset.
const FIELDS = new Set(["dropdown", "filepicker", "number"]);

const span = (n?: number) => Math.max(1, n ?? 1);

const inside = (a: WebWidget, g: WebWidget): boolean =>
  a.col >= g.col &&
  a.row >= g.row &&
  a.col + span(a.colSpan) <= g.col + span(g.colSpan) &&
  a.row + span(a.rowSpan) <= g.row + span(g.rowSpan);

/** Each widget drawn inset, by id: framed by a group that draws a name or a switch, on its left edge. */
export function groupEdgeInsets(
  widgets: Record<string, WebWidget>,
): Map<string, number> {
  const edges = Object.values(widgets).filter(
    (g) => g.type === "group" && (g.label || g.bind),
  );
  const out = new Map<string, number>();
  if (!edges.length) return out;
  for (const [id, w] of Object.entries(widgets)) {
    if (w.type === "group") continue;
    if (edges.some((e) => w.col === e.col && inside(w, e)))
      out.set(id, FIELDS.has(w.type) ? GROUP_FIELD_INSET : GROUP_EDGE_INSET);
  }
  return out;
}
