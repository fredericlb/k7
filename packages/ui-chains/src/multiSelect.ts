// multiSelect.ts — several nodes selected at once (Shift+click), and which of them a control LINKS:
// when every selected node is a use of the same ref on the same engine, a control moved on one moves
// on all of them, since their params are the same params. Pure, so the rule is tested without a DOM.
// The one thing a reader would get wrong: a mixed selection links NOTHING — no partial fan-out.

import type { GraphNode } from "./graph";

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
