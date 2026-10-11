// multiSelect.ts — several nodes selected at once (Shift+click), and which of them a control LINKS:
// when every selected node is a use of the same ref on the same engine, a control moved on one moves
// on all of them by the same TRAVEL, each from where it stood. Pure, so the rule is tested without a DOM.
// A Shift+drag over empty space selects every module card its rectangle touches (`nodesInBox`).
// The one thing a reader would get wrong: a mixed selection links NOTHING — no partial fan-out.

import type { WebWidget } from "@studio/graph-model";
import { type GraphNode, widgetDenorm } from "./graph";

/** Shift+click on `name`: the selection with it toggled, the single selection it grew from counted in. */
export function toggleSelection(
  current: ReadonlySet<string>,
  primary: string | null,
  name: string,
): ReadonlySet<string> {
  const next = new Set(current.size ? current : primary ? [primary] : []);
  if (!next.delete(name)) next.add(name);
  return next;
}

/** The OTHER selected nodes a control on `n` drives too — none unless all share one ref and one engine. */
export function linkedNodes(
  nodes: readonly GraphNode[],
  selection: ReadonlySet<string>,
  n: GraphNode,
): GraphNode[] {
  if (selection.size < 2 || !n.module || !selection.has(n.module)) return [];
  const picked = nodes.filter(
    (m) => m.kind === "module" && !!m.module && selection.has(m.module),
  );
  // Every selected name must be a node here: one that is not (a chain, a lane) makes the selection mixed.
  if (picked.length !== selection.size) return [];
  const same = picked.every(
    (m) => !!m.uses && m.uses === n.uses && m.engine === n.engine,
  );
  // A baked module has no plugin in the engine; it is left out rather than spoiling the rest.
  return same ? picked.filter((m) => m !== n && !m.frozen) : [];
}

/** A linked control's value: its own start moved by the TRAVEL of the one in hand (`t0` → `t`, 0..1 of the throw), clamped. */
export function linkedValue(
  w: WebWidget,
  ownStartT: number,
  t0: number,
  t: number,
): number {
  return widgetDenorm(w, ownStartT + (t - t0));
}

/** The module names whose cards a rectangle TOUCHES, in world coordinates — a Shift+drag's catch. */
export function nodesInBox(
  nodes: readonly GraphNode[],
  box: { x0: number; y0: number; x1: number; y1: number },
): string[] {
  const left = Math.min(box.x0, box.x1);
  const right = Math.max(box.x0, box.x1);
  const top = Math.min(box.y0, box.y1);
  const bottom = Math.max(box.y0, box.y1);
  return nodes
    .filter(
      (n) =>
        n.kind === "module" &&
        !!n.module &&
        n.x < right &&
        n.x + n.w > left &&
        n.y < bottom &&
        n.y + n.h > top,
    )
    .map((n) => n.module as string);
}
