// rowSeams.ts — where a GLUED module row offers its `+`: on each seam between two columns a cable
// joins, and once past the last column; and — in a chain project — on that same seam a BRANCH button,
// which STACKS a new node under the left card (`node stack`). A column is a stack's cards, or one card.
// The one thing a reader would get wrong: a seam between columns is offered only where an arrow
// EXISTS — two neighbours with no cable between them have nothing to splice into (docs/graphBuild.md).

import { portRef, type WebGraph } from "@studio/graph-model";
import { insertFor } from "./cables";
import type { EdgeInsert, GraphNode, LaidOutGraph } from "./graph";

/** One `+` of a glued row, in the row's own coordinates: a vertical seam `h` tall at `x`. */
export interface RowSeam {
  insert: EdgeInsert;
  x: number;
  y: number;
  h: number;
  /** The row's TAIL: drawn past the last card and always shown, where a between-seam waits for the pointer. */
  end?: boolean;
  /** The seam's second button, at `SEAM_BRANCH_AT` of its height: a STACK under its left card. */
  branch?: EdgeInsert;
}

/** Two cards MEET when one ends where the next starts, or one pixel past it — a glued row shares a border. */
const meets = (end: number, start: number): boolean =>
  end === start || end === start + 1;

/** The room the tail `+` takes past the last card, px. */
export const SEAM_END_ROOM = 40;
/** Where on a seam its branch button sits, as a share of its height from the top. */
export const SEAM_BRANCH_AT = 0.8;

/** The seams of a row, its tail when `exit` names the arrow out of the last card, and with `branch` a branch button on each. */
export function rowSeams(
  row: LaidOutGraph,
  exit: EdgeInsert | null,
  branch = false,
): { graph: LaidOutGraph; seams: RowSeam[] } {
  const byId = new Map(row.nodes.map((n) => [n.id, n]));
  const linked = new Set(
    row.edges
      .filter((e) => !e.automation)
      .map((e) => `${e.source}>${e.target}`),
  );
  // Columns by x, left to right, each top to bottom.
  const byX = new Map<number, GraphNode[]>();
  for (const n of row.nodes) byX.set(n.x, [...(byX.get(n.x) ?? []), n]);
  const columns = [...byX.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => c.sort((p, q) => p.y - q.y));

  const seams: RowSeam[] = [];
  const touching = new Set<string>();
  // Two touching cards joined by an arrow: that arrow is glued, and the answer says whether there was one.
  const touch = (a: GraphNode, b: GraphNode): boolean => {
    const key = `${a.id}>${b.id}`;
    if (!linked.has(key)) return false;
    touching.add(key);
    return true;
  };
  for (const col of columns)
    for (let i = 1; i < col.length; i++)
      if (meets(col[i - 1].y + col[i - 1].h, col[i].y))
        touch(col[i - 1], col[i]);
  for (let i = 1; i < columns.length; i++) {
    const a = extent(columns[i - 1]);
    const b = extent(columns[i]);
    if (!meets(a.x + a.w, b.x)) continue;
    // The arrow across the seam, from whichever card of the left column to whichever of the right.
    for (const p of columns[i - 1])
      for (const q of columns[i]) {
        if (!touch(p, q)) continue;
        const insert = insertFor(p.id, q.id, byId);
        const y = Math.max(a.y, b.y);
        const h = Math.min(a.y + a.h, b.y + b.h) - y;
        // A branch stacks under a MODULE: a lane is a source, and nothing goes under it.
        const under =
          branch && p.kind === "module" && p.module
            ? { branch: { before: p.module, after: p.module, stack: true } }
            : {};
        if (insert && h > 0) seams.push({ insert, x: b.x, y, h, ...under });
      }
  }
  // A cable between two touching cards would be a loop drawn backwards over the seam.
  let graph: LaidOutGraph = {
    ...row,
    edges: row.edges.map((e) =>
      touching.has(`${e.source}>${e.target}`) ? { ...e, glued: true } : e,
    ),
  };
  const last = columns[columns.length - 1];
  if (!last || !exit) return { graph, seams };
  const tail = extent(last);
  seams.push({
    insert: exit,
    x: tail.x + tail.w + SEAM_END_ROOM / 2,
    y: tail.y,
    h: tail.h,
    end: true,
  });
  graph = { ...graph, width: graph.width + SEAM_END_ROOM };
  return { graph, seams };
}

/** A column's box: as wide as its widest card, from its top card's top to its bottom card's bottom. */
function extent(col: GraphNode[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const y = Math.min(...col.map((n) => n.y));
  const bottom = Math.max(...col.map((n) => n.y + n.h));
  return {
    x: col[0].x,
    y,
    w: Math.max(...col.map((n) => n.w)),
    h: bottom - y,
  };
}

/** The arrow out of `module` when it ENDS a chain with one way out — what the row's tail splices into. */
export function chainExit(graph: WebGraph, module: string): EdgeInsert | null {
  for (const chain of Object.values(graph.chains)) {
    if (chain.use[chain.use.length - 1]?.module !== module) continue;
    // Two ways out is a fork: the tail cannot pick one for you.
    if (chain.out.length !== 1) return null;
    const { to, fromPort } = chain.out[0];
    // A chain target is entered at its first module; an empty one is drawn as its own node, under its name.
    const after = graph.chains[to]?.use[0]?.module ?? to;
    return { before: portRef(module, fromPort), after };
  }
  return null;
}

/** The tail's arrow: into a card lifted off the row's end when `full` still holds one, else out of the last card's chain. */
export function rowExit(
  full: LaidOutGraph,
  shown: LaidOutGraph,
  graph: WebGraph,
): EdgeInsert | null {
  const last = shown.nodes[shown.nodes.length - 1];
  if (!last) return null;
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const next = full.nodes[full.nodes.findIndex((n) => n.id === last.id) + 1];
  if (
    next &&
    full.edges.some((e) => e.source === last.id && e.target === next.id)
  )
    return insertFor(last.id, next.id, byId);
  return last.module ? chainExit(graph, last.module) : null;
}
