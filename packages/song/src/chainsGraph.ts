// chainsGraph.ts — chains.yaml declares SEGMENTS (who feeds whom); this derives the
// chains from them. A chain is a maximal linear run: it breaks where the signal splits
// and where two signals meet. Full rationale: docs/chainsFile.md.

import type { Chain, Out, Step } from "./graph";
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
        "from `tracks:`/`modules:` segments. Run `pistes migrate chains <project>`.",
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

  const dests = (n: string): string[] => modules[n] ?? [];

  // Every edge, recorded on its DESTINATION as the source's out-degree. Both halves of
  // "does this node continue the run it is in" read off this one map: how many things
  // feed it (the list's length) and whether the one that does feeds anything else.
  const feeders = new Map<string, number[]>();
  const edge = (to: string, srcOutDeg: number): void => {
    const list = feeders.get(to);
    if (list) list.push(srcOutDeg);
    else feeders.set(to, [srcOutDeg]);
  };
  for (const ds of Object.values(tracks))
    for (const d of ds) edge(d, ds.length);
  for (const ds of Object.values(modules))
    for (const d of ds) edge(d, ds.length);

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

  const step = (module: string): Step =>
    bypassed.has(module) ? { module, enabled: false } : { module };
  const outs = (names: string[]): Out[] => names.map((to) => ({ to, gain: 1 }));

  // Modules already inside a chain. Absorption alone decides which run claims a module —
  // except in a cycle, where nothing is a root and this is what stops the walk.
  const placed = new Set<string>();
  const follow = (start: string[]): { use: Step[]; out: Out[] } => {
    const use: Step[] = [];
    let at = start;
    while (at.length === 1 && absorbed(at[0]) && !placed.has(at[0])) {
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
  for (const m of Object.keys(modules)) {
    if (absorbed(m) || placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    add(m, { use: [step(m), ...rest.use], out: rest.out });
  }
  // A cycle has no root, so its modules are still unplaced here. Breaking it at the
  // first one keeps them visible; validate() reports the cycle.
  for (const m of Object.keys(modules)) {
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
