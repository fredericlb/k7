// widgetClipboard.ts — cut, copy and paste of grid widgets: a widget alone, or a GROUP with what it frames.
// Pure, plus one held clip at module level, so a copy survives switching page or module.
// The one thing a reader would get wrong: positions are held RELATIVE to the clip's top-left, so a
// paste lands the whole block at the cell it is dropped on. Rationale: docs/builder.md.

import type { Widget } from "@studio/song-schema/yaml/moduleSchema";
import { framedBy } from "./groupGeometry";

/** What a copy holds: the widgets at clip-relative positions, and the block's size in cells. */
export interface WidgetClip {
  widgets: Record<string, Widget>;
  cols: number;
  rows: number;
}

let held: WidgetClip | null = null;

/** The clip a paste would drop, or null when nothing was copied this session. */
export const heldClip = (): WidgetClip | null => held;

export const holdClip = (clip: WidgetClip): void => {
  held = clip;
};

const span = (n?: number) => Math.max(1, n ?? 1);

/** The ids a cut or a copy of `id` takes: a group brings what it frames, first in the list. */
export function clipIds(widgets: Record<string, Widget>, id: string): string[] {
  const w = widgets[id];
  if (!w) return [];
  return w.type === "group" ? [id, ...framedBy(widgets, w)] : [id];
}

/** A copy of `id` (and, for a group, its members), moved so the block starts at cell 0,0. */
export function copyWidgets(
  widgets: Record<string, Widget>,
  id: string,
): WidgetClip | null {
  const ids = clipIds(widgets, id);
  if (!ids.length) return null;
  const col = Math.min(...ids.map((i) => widgets[i].col));
  const row = Math.min(...ids.map((i) => widgets[i].row));
  const out: Record<string, Widget> = {};
  for (const i of ids)
    out[i] = {
      ...widgets[i],
      col: widgets[i].col - col,
      row: widgets[i].row - row,
    };
  return {
    widgets: out,
    cols: Math.max(...ids.map((i) => out[i].col + span(out[i].colSpan))),
    rows: Math.max(...ids.map((i) => out[i].row + span(out[i].rowSpan))),
  };
}

// The id itself when free, else `<id>_2`, `<id>_3`… — a pasted widget keeps a name a person can read.
function freeId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let k = 2; ; k++) if (!taken.has(`${id}_${k}`)) return `${id}_${k}`;
}

/** `widgets` with `clip` dropped at `at`, pulled back inside the grid; `first` is the block's head, to select. */
export function pasteWidgets(
  widgets: Record<string, Widget>,
  clip: WidgetClip,
  at: { col: number; row: number },
  grid: { cols: number; rows: number },
  taken: Set<string>,
): { widgets: Record<string, Widget>; first: string | null } {
  const col = Math.max(0, Math.min(at.col, grid.cols - clip.cols));
  const row = Math.max(0, Math.min(at.row, grid.rows - clip.rows));
  const next = { ...widgets };
  const used = new Set([...taken, ...Object.keys(widgets)]);
  let first: string | null = null;
  for (const [id, w] of Object.entries(clip.widgets)) {
    const nid = freeId(id, used);
    used.add(nid);
    next[nid] = { ...w, col: w.col + col, row: w.row + row };
    first ??= nid;
  }
  return { widgets: next, first };
}
