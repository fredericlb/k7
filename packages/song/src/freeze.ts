// freeze.ts — freezing at a MODULE: what is upstream of it, and whether that set can be replaced
// by one render. Pure graph work over the derived chains, no filesystem, so a browser can ask the
// same question the compiler does. Full rationale: docs/freeze.md.

import type { Chain } from "./graph";
import { splitPort } from "./moduleTypes";

/** One node of the signal graph, at the granularity a freeze cares about. */
type Node = string; // a lane name, or a module (chain step) name

/**
 * Every edge of the derived chains, as `from -> to` between NODES.
 *
 * Node-level rather than chain-level, because a freeze cuts INSIDE a run: `[ lane, amp, cab ]`
 * frozen at `amp` keeps `cab` live, and a chain-level walk cannot say that.
 *
 * A destination may name a port (`crossfade#b`); only the node matters here, so the jack comes
 * off. A step's `in:` sources are edges too — a side input is signal arriving, and signal
 * arriving is exactly what a freeze bakes.
 */
function edges(chains: Record<string, Chain>): { from: Node; to: Node }[] {
  const out: { from: Node; to: Node }[] = [];
  const node = (ref: string) => splitPort(ref).node;
  for (const c of Object.values(chains)) {
    const steps = c.use.map((s) => s.module);
    // The lane (or the chain this one is fed by) into the first step, and each step into the next.
    const path = [...(c.from ? [c.from] : []), ...steps];
    for (let i = 0; i + 1 < path.length; i++)
      out.push({ from: path[i], to: path[i + 1] });
    // …and whatever the run ENDS on into each of its destinations. A chain with no steps and no
    // `from` has nothing to leave from, which is a parked node.
    const last = path[path.length - 1];
    if (last) for (const o of c.out) out.push({ from: last, to: node(o.to) });
    // Side inputs: `in:` names what feeds that step's named port.
    for (const s of c.use)
      for (const src of Array.isArray(s.in) ? s.in : [])
        out.push({ from: node(String(src)), to: s.module });
  }
  return out;
}

/**
 * Every node whose signal reaches `module` — the module ITSELF included.
 *
 * That "included" is the whole definition: freezing a module bakes what arrives at it AND what it
 * does to it, because the render is taken at its output. Freezing the amp gives you the amped
 * sound, not the sound going into the amp.
 *
 * A cycle stops at the repeat rather than looping: a graph that loops is reported by `validate`,
 * and a freeze should not be the thing that hangs on it.
 */
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

/**
 * Why this module cannot be frozen, or null.
 *
 * The one condition, and it is what makes a render honest: everything upstream must feed NOTHING
 * outside the set. A lane inside it that also plays into somewhere else is still needed live —
 * its signal is in the render AND on its other path, so the render would be heard twice and
 * unfreezing would be the only way to hear it once.
 *
 * Refused rather than guessed at. Silencing the other path would take away audio nobody asked to
 * lose, and leaving it would double a signal at a level nothing on screen explains. The way out
 * is in the message: freeze further downstream, at the point the two paths meet.
 *
 * `module`'s own destinations are exempt — leaving is what a freeze point is for.
 */
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

/**
 * What a freeze at `module` does to the compiled doc, resolved once.
 *
 * `lanes` lose their clips (their material is in the render), `modules` lose their plugins (their
 * processing is too), and the render becomes the ONE clip of `module`'s owner track. One rule for
 * both shapes a freeze takes: a point inside one lane's run, and a bus several lanes meet at.
 */
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

/**
 * The plan for every frozen module in the project, keyed by the module it is taken at.
 *
 * `isLane` tells the two kinds of node apart — the same predicate the chain derivation takes, and
 * for the same reason: with one `modules:` map only what a name extends says which it is.
 */
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

/**
 * The plans that are really IN FORCE — every module carrying `frozen:` whose render is on disk.
 *
 * The one place both readers of the field go through, so the compiler and the graph cannot
 * disagree about which nodes are baked. `exists` is injected rather than imported: this file does
 * no filesystem work, so a surface with no disk can pass `() => true` and get the same answer
 * about the shape of the freeze.
 *
 * A render that is not THERE is deliberately not an error. A render is a generated artifact, big
 * and regenerable, and a project is very often cloned without it; failing would lock you out of
 * the very command that clears the attribute. So a missing file simply means not frozen — it
 * plays live, which is what it did before.
 */
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
