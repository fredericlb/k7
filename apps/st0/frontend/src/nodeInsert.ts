// nodeInsert.ts — what the graph's `+` types into the command bar.
//
// One command, one round trip, one reload: `node new` creates the node AND splices the wiring, a
// catalogue pick's node extending its ref directly, so the frontend never has to learn a name
// before it can put it in a chain.
//
// The arrow goes FIRST in the line so the node name lands last, where a person types it. That is
// the whole reason for the argument order.

import type { WebGraph } from "@studio/graph-model";
import { instanceName } from "@studio/song-schema/instanceName";

/** The pending half of a `+` click: the arrow the module is being dropped onto. */
export interface PendingInsert {
  before: string;
  after: string;
  /** A bottom `+`: the new node is STACKED under `before` rather than spliced into an arrow. */
  stack?: boolean;
}

/** The lane a `+` on this arrow drops onto — a chain is called after its lane, so the key IS the answer, port or no port. */
export function laneOfArrow(
  graph: Pick<WebGraph, "chains">,
  before: string | null | undefined,
): string | null {
  if (!before) return null;
  const node = before.split("#")[0];
  if (graph.chains[node]) return node;
  for (const [lane, c] of Object.entries(graph.chains))
    if (c.use.some((s) => s.module.split("#")[0] === node)) return lane;
  return null;
}

/** Every name this graph already spells — only what the BROWSER can see, and `createNode` refuses a collision out loud. */
function namesIn(graph: WebGraph): Set<string> {
  const out = new Set<string>(graph.tracks);
  for (const [lane, c] of Object.entries(graph.chains)) {
    out.add(lane);
    for (const s of c.use) out.add(s.module.split("#")[0]);
    for (const o of c.out) out.add(o.to.split("#")[0]);
  }
  for (const n of graph.videoTracks ?? []) out.add(n);
  for (const n of Object.keys(graph.modules ?? {})) out.add(n);
  for (const n of Object.keys(graph.curves ?? {})) out.add(n);
  return out;
}

/** What a node of `module` dropped on this arrow should be CALLED — here, because only the browser knows the arrow (@studio/song's rule). */
export function nodeNameFor(
  graph: WebGraph,
  module: string,
  before: string | null,
): string {
  const taken = namesIn(graph);
  return instanceName(module, laneOfArrow(graph, before), (n) => taken.has(n));
}

/** What a chain should NAME, given the creating command that just ran — a node is named by its FILE alone. */
export function chainRefFromCreate(line: string): string | null {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "node" || parts[1] !== "new") return null;
  const args = parts.slice(2);
  // "<type>/<name>" — the module's own folder. Anything else is a line the command rejects.
  const segs = (args[0] ?? "").split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  // A catalogue pick's ref rides on the line; a node name never carries a slash, so that is the filter.
  return args.slice(1).find((p) => !p.includes("/")) ?? null;
}

/** The line the `+` pre-writes: `node new`, which puts the node in the graph itself — not `module new`, which stopped making nodes. */
export const createForGraphCommand = (type: string, name: string): string =>
  `node new ${type}/${name} `;

/** The catalogue ref that rides ON the line, which the node extends directly. The ref goes before the spawn token, which the verb reads off the END. */
export const nodeNewRefArg = (ref?: string): string => (ref ? ` ${ref}` : "");

/** Where the node that line makes should GO — a splice on an ARROW, and on the bare canvas only the pin, and only with a point. */
export const wireCommand = (
  ref: string,
  at: PendingInsert | null,
  spawn?: { x: number; y: number } | null,
): string | null => {
  const x = spawn ? Math.round(spawn.x) : 0;
  const y = spawn ? Math.round(spawn.y) : 0;
  if (at?.stack) return `node stack ${at.before} ${ref}`;
  if (at)
    return `node insert ${at.before} ${at.after} ${ref}${spawn ? ` ${x},${y}` : ""}`;
  return spawn ? `graph move ${ref} ${x} ${y}` : null;
};
