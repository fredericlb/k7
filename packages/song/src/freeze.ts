// freeze.ts — freezing at a MODULE: what is upstream of it, and whether that set can be replaced
// by one render. Pure graph work over the derived chains, no filesystem, so a browser can ask the
// same question the compiler does. Full rationale: docs/freeze.md.

import { splitPort } from "@studio/song-schema/moduleTypes";
import type { Chain } from "./graph";

/** One node of the signal graph, at the granularity a freeze cares about. */
type Node = string; // a lane name, or a module (chain step) name

/** Every edge of the derived chains, between NODES rather than chains — see docs/freeze.md. */
function edges(chains: Record<string, Chain>): { from: Node; to: Node }[] {
  const out: { from: Node; to: Node }[] = [];
  const node = (ref: string) => splitPort(ref).node;
  for (const c of Object.values(chains)) {
    const steps = c.use.map((s) => s.module);
    // The lane (or the chain this one is fed by) into the first step, and each step into the next.
    const path = [...(c.from ? [c.from] : []), ...steps];
    for (let i = 0; i + 1 < path.length; i++)
      out.push({ from: path[i], to: path[i + 1] });
    // …and whatever the run ENDS on into each destination; a chain with neither is a parked node.
    const last = path[path.length - 1];
    if (last) for (const o of c.out) out.push({ from: last, to: node(o.to) });
    // Side inputs: `in:` names what feeds that step's named port.
    for (const s of c.use)
      for (const src of Array.isArray(s.in) ? s.in : [])
        out.push({ from: node(String(src)), to: s.module });
  }
  return out;
}

/** Every node whose signal reaches `module`, the module ITSELF included — see docs/freeze.md. */
export function upstreamOf(
  chains: Record<string, Chain>,
  module: string,
): Set<Node> {
  const back = new Map<Node, Node[]>();
  for (const e of edges(chains))
    back.set(e.to, [...(back.get(e.to) ?? []), e.from]);
  const seen = new Set<Node>([module]);
  const queue = [module];
  while (queue.length) {
    for (const from of back.get(queue.pop() as Node) ?? [])
      if (!seen.has(from)) {
        seen.add(from);
        queue.push(from);
      }
  }
  return seen;
}

/** Why this module cannot be frozen, or null — everything upstream must feed nothing outside, docs/freeze.md. */
export function freezeBlockedBy(
  chains: Record<string, Chain>,
  module: string,
): string | null {
  const inside = upstreamOf(chains, module);
  if (inside.size === 1 && !hasNode(chains, module))
    return `no module "${module}" in the chains`;
  for (const e of edges(chains)) {
    if (e.from === module || !inside.has(e.from) || inside.has(e.to)) continue;
    return (
      `'${e.from}' is upstream of '${module}' but also feeds '${e.to}', which is not — ` +
      `its signal would be in the render AND still playing. Freeze at the point they meet instead.`
    );
  }
  return null;
}

/** Is `node` a lane or a step the chains actually name? */
function hasNode(chains: Record<string, Chain>, node: Node): boolean {
  return Object.values(chains).some(
    (c) => c.from === node || c.use.some((s) => s.module === node),
  );
}

/** What a freeze at `module` does to the compiled doc, resolved once — see docs/freeze.md. */
export interface FreezePlan {
  /** The module the render was taken at. */
  at: string;
  /** The render itself, as the module wrote it: a project-relative path. */
  render: string;
  /** Lanes whose clips the render replaces. */
  lanes: Set<string>;
  /** Modules whose plugins the render already contains. */
  modules: Set<string>;
}

/** The plan for every frozen module; `isLane` is the chain derivation's own predicate, and for its reason. */
export function freezePlans(
  chains: Record<string, Chain>,
  frozenAt: [string, string][],
  isLane: (n: string) => boolean,
): FreezePlan[] {
  return frozenAt
    .filter(([m]) => hasNode(chains, m))
    .map(([at, render]) => {
      const inside = upstreamOf(chains, at);
      const lanes = new Set<string>();
      const modules = new Set<string>();
      for (const n of inside) (isLane(n) ? lanes : modules).add(n);
      return { at, render, lanes, modules };
    });
}

/** The plans really IN FORCE, `exists` injected so a diskless surface can ask too — docs/freeze.md. */
export function activeFreezePlans(
  chains: Record<string, Chain>,
  modules: Record<string, { frozen?: unknown } | undefined>,
  isLane: (n: string) => boolean,
  exists: (render: string) => boolean,
): FreezePlan[] {
  const frozenAt = Object.entries(modules)
    .filter(([, m]) => typeof m?.frozen === "string" && m.frozen)
    .map(([name, m]) => [name, String(m?.frozen)] as [string, string])
    .filter(([, render]) => exists(render));
  return freezePlans(chains, frozenAt, isLane);
}
