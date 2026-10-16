// nodeLayout.ts — the arithmetic of a card's header: how wide its name may run, which corner
// buttons and lead column it carries, how big a glyph it draws — docs/nodeCard.md.

import type { WebWidget } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";
import { BYPASS_GAP, BYPASS_W } from "./chainsCss";

// A group is painted UNDER what it frames, so it comes first; the sort is stable for everything else.
export const groupsFirst = (
  ws: Record<string, WebWidget>,
): [string, WebWidget][] =>
  Object.entries(ws).sort(
    ([, a], [, b]) => +(b.type === "group") - +(a.type === "group"),
  );

// Fit one line of text to a box in world units: glyph-count width, capped by height, floored so it never vanishes.
export function fitFont(label: string, w: number, h: number): number {
  const GLYPH = 0.58;
  const byWidth = (w * 0.86) / Math.max(1, label.length * GLYPH);
  return Math.max(8, Math.min(byWidth, h * 0.6));
}

/** What the header leaves the NAME, in px — the top row's own numbers, repeated, docs/nodeCard.md. */
export function headerNameW(
  n: GraphNode,
  hasGlyph: boolean,
  rightW = 0,
): number {
  const HD_PAD = 10;
  const HD_GAP = 7;
  // The glyph and its gap lead the name's row — unless it has gone to the left column.
  const lead = hasLeadColumn(n) ? 0 : (hasGlyph ? 13 : 8) + HD_GAP;
  // The left column (on/off, or a track's icon) replaces the left padding with its own width and the gap after it.
  const left = hasLeadColumn(n) ? BYPASS_W + BYPASS_GAP : HD_PAD;
  // What stands right of the name — `rightW`, each item's gap included; the corner bubbles take nothing, hanging off at `top:-8px`.
  return Math.max(16, n.w - left - HD_PAD - lead - rightW);
}

/** Whether a node draws the on/off block: a live module, not a baked one (nothing to bypass) nor a strip (never off). */
export function hasBypass(n: GraphNode): boolean {
  return (
    n.kind === "module" &&
    !!n.module &&
    !n.strip &&
    !(n.frozen && n.kind === "module")
  );
}

/** Whether the header leads with its left column — the node's icon, which on a live module is its on/off. */
export function hasLeadColumn(n: GraphNode): boolean {
  return n.kind === "track" || (n.kind === "module" && !!n.module);
}

/** One corner bubble, in the order they sit: the corner first, then leftwards. */
export type CornerButton = "plugin" | "open";

/** Which bubbles a node's corner shows — ONE list, read by three things, docs/nodeCard.md. */
export function cornerButtons(n: GraphNode): CornerButton[] {
  const out: CornerButton[] = [];
  // Not on a baked module: no live plugin, so no window to open.
  const baked = !!n.frozen && n.kind === "module";
  if (n.hasNativePluginUI && n.module && !baked) out.push("plugin");
  // The only way into a box, and the only way back out of one — see packages/song/docs/assemblies.md.
  if (n.assemblyOf && n.module) out.push("open");
  return out;
}

/** The header's tags right of the name: the warning's and the snowflake's discs, and the console tag sized to its text — set, not measured. */
export const FREEZE_TAG_W = 15;
// The header row's gap, which every item right of the name pays once — chainsCss.ts's `.dgx-hdtop`.
export const HD_ROW_GAP = 7;

// The glyph's height on the far card, taken from the NODE: it sits on its own line, so it needs a share of height.
export const farIconPx = (w: number, h: number): number =>
  Math.min(h * 0.34, w * 0.34);
