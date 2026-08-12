// chainsGraph.ts — chains.yaml declares SEGMENTS (who feeds whom); this derives the
// chains from them. A chain is a maximal linear run: it breaks where the signal splits
// and where two signals meet. Full rationale: docs/chainsFile.md.

import type { Chain, Out, Step } from "./graph";
import { splitPort } from "./moduleTypes";
import { parseChains } from "./yaml/chainsFile";
import { type ChainsFile, ChainsFileSchema } from "./yaml/chainsSchema";

/** The source a chain TEMPLATE starts at — a lane's place, without a lane. A template is
 *  what the médiathèque holds: segments with no song around them. */
export const CHAIN_IN = "@in";
/** …and where it ends, standing where a song's `OUT` sink does. */
export const CHAIN_OUT = "@out";
/** One edge as the derivation walks it: where it lands, and which output it left from. */
interface Dest {
  to: string;
  fromPort?: string;
}

/**
 * Which of the file's nodes are LANES — the runs are named after them, and `from` is what says so.
 *
 * The file cannot answer this on its own: with one `modules:` map, `melody` and `reverb` are
 * spelled identically and only what they EXTEND tells them apart (docs/trackModules.md). So the
 * caller that holds the module map supplies it, and one that holds no project — a chain template
 * in the médiathèque, the editor's live re-parse — supplies nothing and gets `@in` alone, which is
 * exactly the lane a template has.
 */
export type IsLane = (name: string) => boolean;

/**
 * The chains a segment file describes, keyed by name — a lane-fed run is called after its lane, a run the
 * signal joins into after the module it starts at.
 *
 * Accepts the raw value (project.yaml may inline it) and validates: a caller holding an unparsed object should
 * still get chains or a clear failure, never a half-read graph.
 */
export function deriveChains(
  raw: unknown,
  isLane?: IsLane,
): Record<string, Chain> {
  if (raw == null) return {};
  // The old format, named precisely rather than reported as an unknown key: someone
  // opening a project written last month needs the migration, not a schema error.
  if (Array.isArray(raw) || Array.isArray((raw as { chains?: unknown }).chains))
    throw new Error(
      "chains.yaml: `chains:` is the old chain-list format — chains are now derived " +
        "from `modules:` segments. Run `l8 migrate chains <project>`.",
    );
  const parsed = ChainsFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `chains.yaml: ${parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  return chainsOf(parsed.data, isLane);
}

/**
 * The names `bypassed:` lists, from a raw (possibly unreadable) chains value.
 *
 * Its own reader because a LANE's mute is its bypass, and the lane projection needs the set before
 * any chain is derived — a lane appears in `from`, never in a step, so `Step.enabled` never
 * carries it. Total on garbage: a file the schema would refuse still has to draw its lanes, and
 * "nothing is muted" is the right answer to give while the editor reports why.
 */
export function bypassedOf(raw: unknown): Set<string> {
  const list = (raw as { bypassed?: unknown })?.bypassed;
  return new Set(
    Array.isArray(list) ? list.filter((n) => typeof n === "string") : [],
  );
}

/** The same derivation over an already-validated file. */
export function chainsOf(
  file: ChainsFile,
  isLane: IsLane = () => false,
): Record<string, Chain> {
  const modules = file.modules ?? {};
  const bypassed = new Set(file.bypassed ?? []);

  // `@in` is a lane wherever it appears: a template has no project to ask, and it is the one name
  // that means "the signal starts here" with nothing behind it.
  const lane = (n: string): boolean => n === CHAIN_IN || isLane(n);

  // Everything below reasons about the NODE, never the port: `crossfade` fed twice is one
  // meeting point, not two nodes. The port rides along on the edge and is read back where it
  // means something — which input of the target this feeder lands on.
  const nodeOf = (ref: string): string => splitPort(ref).node;

  // A module may be keyed with a port on the source side too (`deck#cue: [...]`), so its
  // destinations are the UNION of every key naming it. Keying on the raw string would have
  // split one module into two nodes that never met.
  //
  // The key's port is kept on each edge as `fromPort`: the union decides the module's IDENTITY,
  // it does not have to cost which jack the cable left from. A module with several outputs — a
  // stem separator — is unsayable without it. See docs/ports.md.
  const dests = (n: string): Dest[] => {
    const out: Dest[] = [];
    for (const [key, ds] of Object.entries(modules)) {
      const { node, port } = splitPort(key);
      if (node !== n) continue;
      for (const to of ds) out.push(port ? { to, fromPort: port } : { to });
    }
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
  //
  // The out-degree is the NODE's, not the key's. A module keyed once is the same either way,
  // but one split across its outputs (`sep#drums:` and `sep#bass:`, a key apiece) has two
  // lists of one — and per-key counting would call each edge an only child, absorbing both
  // targets into a single run through a module that in fact splits.
  for (const [key, ds] of Object.entries(modules)) {
    const deg = dests(nodeOf(key)).length;
    for (const d of ds) if (!splitPort(d).port) edge(d, deg);
  }

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
  for (const [m, ds] of Object.entries(modules))
    for (const d of ds) feedPort(nodeOf(m), d);

  /**
   * Does `n` belong to the run that reaches it, rather than starting one of its own?
   *
   * Only when all three hold: exactly one thing feeds it (two would make it a meeting point — a bus), that one
   * thing feeds nothing else (a split ends the run before it), and it has somewhere to go (a node the signal
   * stops at is the run's DESTINATION, which is what `out` means — the same shape the old list format gave a
   * chain's last node).
   *
   * A LANE is never absorbed, whatever feeds it. A live interface channel routed into one satisfies all three
   * — one feeder, feeding nothing else, and the lane goes somewhere — so without this the input's run would
   * swallow the lane as its next step, and the chain that OWNS the lane's material would cease to exist.
   */
  const absorbed = (n: string): boolean => {
    if (lane(n)) return false;
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
  // A destination keeps BOTH ports: `to` carries which input it lands on (downstream reads the
  // bare name with splitPort), `fromPort` which output it left from. They are separate fields
  // because they are separate facts — the target's jack is part of the address, the source's is
  // part of the source.
  const outs = (ds: Dest[]): Out[] =>
    ds.map((d) => ({
      to: d.to,
      gain: 1,
      ...(d.fromPort ? { fromPort: d.fromPort } : {}),
    }));

  // Modules already inside a chain. Absorption alone decides which run claims a module —
  // except in a cycle, where nothing is a root and this is what stops the walk.
  const placed = new Set<string>();
  const follow = (start: Dest[]): { use: Step[]; out: Out[] } => {
    const use: Step[] = [];
    let at = start;
    // The walk steps on NODES; a port only ever decorates the edge that got here. A single
    // destination carrying one is not followed at all — `absorbed` reads the flow feeders, and
    // a side input contributes none. `fromPort` never gates the walk either: it says where the
    // edge came from, and a module with one output that names it is still a plain run.
    while (
      at.length === 1 &&
      !splitPort(at[0].to).port &&
      absorbed(at[0].to) &&
      !placed.has(at[0].to)
    ) {
      placed.add(at[0].to);
      use.push(step(at[0].to));
      at = dests(at[0].to);
    }
    return { use, out: outs(at) };
  };

  const chains: Record<string, Chain> = {};

  // The LANES first, and they are claimed whether or not they are wired: a lane is where a run
  // begins, so it is never a step in somebody else's. `from` is the whole difference — the run
  // takes the lane's name, and that name is its identity downstream (routing target, bus track,
  // the prefix of every plugin id under it).
  //
  // There is no "both a track and a module" refusal here any more. It existed because the file
  // had two maps and one name could appear in each; with one map a name is one node, and the
  // collision it guarded against cannot be written.
  for (const n of moduleNodes()) {
    if (!lane(n)) continue;
    placed.add(n);
    const ds = dests(n);
    if (!ds.length) continue; // feeds nothing — the same as not being listed
    chains[n] = { from: n, ...follow(ds) };
  }
  // Then every module that starts a run of its own: a bus (several things feed it), the
  // far side of a split, or a node nothing feeds at all.
  for (const m of moduleNodes()) {
    if (absorbed(m) || placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    chains[m] = { use: [step(m), ...rest.use], out: rest.out };
  }
  // A cycle has no root, so its modules are still unplaced here. Breaking it at the
  // first one keeps them visible; validate() reports the cycle.
  for (const m of moduleNodes()) {
    if (placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    chains[m] = { use: [step(m), ...rest.use], out: rest.out };
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

/**
 * The modules a segments file puts the signal through, in order, deduplicated.
 *
 * What a PLAYER needs and a drawing does not: the graph shows the segments as they branch,
 * while playing or bouncing one is a single track carrying a plugin per step. Derived from the
 * same parse the drawing uses, so the chain that is seen and the chain that is heard cannot be
 * two different chains — which is why it lives here, beside the derivation, rather than in
 * whichever surface plays it. The médiathèque draws a variant with it; l8's `track process` and
 * `clip process` bounce one with it.
 *
 * `@in` and `@out` are dropped: they are the ends, not treatments. Unreadable text is an empty
 * list rather than a throw — the pane showing the file is what reports why.
 */
export function chainSteps(text: string): string[] {
  const parsed = parseChains(text);
  if (!parsed.value) return [];
  let derived: Record<string, Chain>;
  try {
    derived = chainsOf(parsed.value);
  } catch {
    return []; // a shape the derivation refuses — nothing to play
  }
  const out: string[] = [];
  for (const c of Object.values(derived))
    for (const s of c.use)
      if (
        s.module !== CHAIN_IN &&
        s.module !== CHAIN_OUT &&
        !out.includes(s.module)
      )
        out.push(s.module);
  return out;
}
