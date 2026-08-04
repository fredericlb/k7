// chainsGraph.ts — chains.yaml declares SEGMENTS (who feeds whom); this derives the
// chains from them. A chain is a maximal linear run: it breaks where the signal splits
// and where two signals meet. Full rationale: docs/chainsFile.md.

import type { Chain, Out, Step } from "./graph";
import { splitPort } from "./moduleTypes";
import { type ChainsFile, ChainsFileSchema } from "./yaml/chainsSchema";

/**
 * The chains a segment file describes, keyed by name — a track-fed run is called after its track, a run the
 * signal joins into after the module it starts at.
 *
 * Accepts the raw value (project.yaml may inline it) and validates: a caller holding an unparsed object should
 * still get chains or a clear failure, never a half-read graph.
 */
export function deriveChains(raw: unknown): Record<string, Chain> {
  if (raw == null) return {};
  // The old format, named precisely rather than reported as an unknown key: someone
  // opening a project written last month needs the migration, not a schema error.
  if (Array.isArray(raw) || Array.isArray((raw as { chains?: unknown }).chains))
    throw new Error(
      "chains.yaml: `chains:` is the old chain-list format — chains are now derived " +
        "from `tracks:`/`modules:` segments. Run `l8 migrate chains <project>`.",
    );
  const parsed = ChainsFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `chains.yaml: ${parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  return chainsOf(parsed.data);
}

/** The same derivation over an already-validated file. */
export function chainsOf(file: ChainsFile): Record<string, Chain> {
  const tracks = file.tracks ?? {};
  const modules = file.modules ?? {};
  const bypassed = new Set(file.bypassed ?? []);

  // Everything below reasons about the NODE, never the port: `crossfade` fed twice is one
  // meeting point, not two nodes. The port rides along on the edge and is read back where it
  // means something — which input of the target this feeder lands on.
  const nodeOf = (ref: string): string => splitPort(ref).node;

  // A module may be keyed with a port on the source side too (`deck#cue: [...]`), so its
  // destinations are the UNION of every key naming it. Keying on the raw string would have
  // split one module into two nodes that never met.
  const dests = (n: string): string[] => {
    const out: string[] = [];
    for (const [key, ds] of Object.entries(modules))
      if (nodeOf(key) === n) out.push(...ds);
    return out;
  };
  // …and the module names this file mentions, each once, in first-seen order.
  const moduleNodes = (): string[] => {
    const seen: string[] = [];
    for (const key of Object.keys(modules)) {
      const n = nodeOf(key);
      if (!seen.includes(n)) seen.push(n);
    }
    return seen;
  };

  // Every edge, recorded on its DESTINATION as the source's out-degree. Both halves of
  // "does this node continue the run it is in" read off this one map: how many things
  // feed it (the list's length) and whether the one that does feeds anything else.
  const feeders = new Map<string, number[]>();
  const edge = (to: string, srcOutDeg: number): void => {
    const list = feeders.get(to);
    if (list) list.push(srcOutDeg);
    else feeders.set(to, [srcOutDeg]);
  };
  // BARE destinations only — those are the flow. A destination naming a port is a side input
  // (below), and counting it here would make a module absorbed into a run that only feeds its
  // second port, so the run would claim it as its next step and its real flow input would go
  // unnoticed.
  for (const ds of Object.values(tracks))
    for (const d of ds) if (!splitPort(d).port) edge(d, ds.length);
  for (const ds of Object.values(modules))
    for (const d of ds) if (!splitPort(d).port) edge(d, ds.length);

  // What feeds each module through a NAMED port, in the order the file lists it. These are the
  // wires past the chain flow — a chain carries one signal, and a second input has to arrive
  // from somewhere else — so they land on the step as `in`, which validate() checks against the
  // module's port list. A bare destination is not here: it is the flow itself.
  const named = new Map<string, string[]>();
  const feedPort = (from: string, to: string): void => {
    const { node, port } = splitPort(to);
    if (!port) return;
    const list = named.get(node);
    if (list) list.push(from);
    else named.set(node, [from]);
  };
  for (const [t, ds] of Object.entries(tracks))
    for (const d of ds) feedPort(t, d);
  for (const [m, ds] of Object.entries(modules))
    for (const d of ds) feedPort(nodeOf(m), d);

  /**
   * Does `n` belong to the run that reaches it, rather than starting one of its own?
   *
   * Only when all three hold: exactly one thing feeds it (two would make it a meeting point — a bus), that one
   * thing feeds nothing else (a split ends the run before it), and it has somewhere to go (a node the signal
   * stops at is the run's DESTINATION, which is what `out` means — the same shape the old list format gave a
   * chain's last node).
   */
  const absorbed = (n: string): boolean => {
    const f = feeders.get(n);
    return f?.length === 1 && f[0] === 1 && dests(n).length > 0;
  };

  // A step carries the sources wired to its NAMED ports, so the chain says what reaches the
  // module beyond the one signal flowing through it.
  const step = (module: string): Step => {
    const extra = named.get(module);
    return {
      module,
      ...(extra?.length ? { in: extra } : {}),
      ...(bypassed.has(module) ? { enabled: false } : {}),
    };
  };
  // A destination keeps its port: `to` is what the chain routes to, and which input it lands on
  // is part of that. Downstream reads the node with splitPort where it needs the bare name.
  const outs = (names: string[]): Out[] => names.map((to) => ({ to, gain: 1 }));

  // Modules already inside a chain. Absorption alone decides which run claims a module —
  // except in a cycle, where nothing is a root and this is what stops the walk.
  const placed = new Set<string>();
  const follow = (start: string[]): { use: Step[]; out: Out[] } => {
    const use: Step[] = [];
    let at = start;
    // The walk steps on NODES; a port only ever decorates the edge that got here. A single
    // destination carrying one is not followed at all — `absorbed` reads the flow feeders, and
    // a side input contributes none.
    while (
      at.length === 1 &&
      !splitPort(at[0]).port &&
      absorbed(at[0]) &&
      !placed.has(at[0])
    ) {
      placed.add(at[0]);
      use.push(step(at[0]));
      at = dests(at[0]);
    }
    return { use, out: outs(at) };
  };

  const chains: Record<string, Chain> = {};
  const add = (name: string, chain: Chain): void => {
    if (name in chains)
      throw new Error(
        `chains.yaml: '${name}' is both a track and a module — a chain's name is its ` +
          `identity (routing target, bus track, plugin ids), so the two cannot share one.`,
      );
    chains[name] = chain;
  };

  // A track's chain: the track feeds it, and the run picks up from its destinations.
  for (const [track, ds] of Object.entries(tracks)) {
    if (!ds.length) continue; // feeds nothing — the same as not being listed
    add(track, { from: track, ...follow(ds) });
  }
  // Then every module that starts a run of its own: a bus (several things feed it), the
  // far side of a split, or a node nothing feeds at all.
  for (const m of moduleNodes()) {
    if (absorbed(m) || placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    add(m, { use: [step(m), ...rest.use], out: rest.out });
  }
  // A cycle has no root, so its modules are still unplaced here. Breaking it at the
  // first one keeps them visible; validate() reports the cycle.
  for (const m of moduleNodes()) {
    if (placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    add(m, { use: [step(m), ...rest.use], out: rest.out });
  }
  return chains;
}

/**
 * A chain holding one module, wired to nothing at either end — a node that has been placed but not connected.
 *
 * It is a real state in a graph editor (drop a module in, wire it after), so the wiring checks skip it: telling
 * someone their brand-new input feeds no track is an answer to a question they haven't asked yet.
 */
export function isParked(c: Chain): boolean {
  return !c.from && c.use.length === 1 && !c.out.length;
}
