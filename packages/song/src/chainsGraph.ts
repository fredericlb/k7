// chainsGraph.ts — graph.yaml declares SEGMENTS (who feeds whom); this derives the
// chains from them. A chain is a maximal linear run: it breaks where the signal splits
// and where two signals meet. Full rationale: docs/graphFile.md.

import {
  MIX_NODE,
  RENDER_NODE,
  splitPort,
} from "@studio/song-schema/moduleTypes";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import {
  type GraphFile,
  GraphFileSchema,
} from "@studio/song-schema/yaml/graphSchema";
import type { Chain, Out, Step } from "./graph";

/** The source a chain TEMPLATE starts at — a lane's place, without a lane. See docs/graphFile.md. */
export const CHAIN_IN = "@in";
/** …and where it ends, standing where a song's `OUT` sink does. */
export const CHAIN_OUT = "@out";
/** One edge as the derivation walks it: where it lands, and which output it left from. */
interface Dest {
  to: string;
  fromPort?: string;
}

/** Which of the file's nodes are LANES — supplied by the caller that holds the module map, docs/graphFile.md. */
export type IsLane = (name: string) => boolean;

/** The chains a segment file describes, keyed by name, validating a raw value — see docs/graphFile.md. */
export function deriveChains(
  raw: unknown,
  isLane?: IsLane,
): Record<string, Chain> {
  if (raw == null) return {};
  // The old format, named precisely: opening last month's project needs the migration, not a schema error.
  if (Array.isArray(raw) || Array.isArray((raw as { chains?: unknown }).chains))
    throw new Error(
      "graph.yaml: `chains:` is the old chain-list format — chains are now derived " +
        "from `modules:` segments. Run: npx tsx packages/song/scripts/migrateChains.ts <project>",
    );
  const parsed = GraphFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `graph.yaml: ${parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  return chainsOf(parsed.data, isLane);
}

/** The names `bypassed:` lists, from a raw and possibly unreadable value — see docs/graphFile.md. */
export function bypassedOf(raw: unknown): Set<string> {
  const list = (raw as { bypassed?: unknown })?.bypassed;
  return new Set(
    Array.isArray(list) ? list.filter((n) => typeof n === "string") : [],
  );
}

/** The same derivation over an already-validated file. */
export function chainsOf(
  file: GraphFile,
  isLane: IsLane = () => false,
): Record<string, Chain> {
  const modules = file.modules ?? {};
  const bypassed = new Set(file.bypassed ?? []);

  // `@in`, `MIX` and `RENDER` are lanes wherever they appear, and none may be absorbed — docs/graphFile.md.
  const lane = (n: string): boolean => {
    const node = splitPort(n).node;
    return (
      node === CHAIN_IN ||
      node === MIX_NODE ||
      node === RENDER_NODE ||
      isLane(node)
    );
  };

  // Everything below reasons about the NODE, never the port: `crossfade` fed twice is one meeting point.
  const nodeOf = (ref: string): string => splitPort(ref).node;

  // A LANE keyed on more than one output is more than one SOURCE, the one exception — docs/graphFile.md.
  const splitLanes = new Set<string>();
  // …and, for a lane keyed exactly ONCE, the port that key named — the compiler needs to hear it.
  const soleLanePort = new Map<string, string | undefined>();
  {
    const perLane = new Map<string, Set<string>>();
    for (const key of Object.keys(modules)) {
      if (!lane(key)) continue;
      const node = nodeOf(key);
      const keys = perLane.get(node) ?? new Set<string>();
      keys.add(key);
      perLane.set(node, keys);
    }
    for (const [node, keys] of perLane)
      if (keys.size > 1) splitLanes.add(node);
      else soleLanePort.set(node, splitPort([...keys][0]).port);
  }
  // What a source key is a run OF: its node, or the key itself for a split lane's output.
  const srcId = (key: string): string =>
    splitLanes.has(nodeOf(key)) ? key : nodeOf(key);

  // The UNION of every key naming a module, its port kept per edge as `fromPort` — see docs/graphFile.md.
  const dests = (n: string): Dest[] => {
    const out: Dest[] = [];
    for (const [key, ds] of Object.entries(modules)) {
      const { port } = splitPort(key);
      if (srcId(key) !== n) continue;
      for (const to of ds) out.push(port ? { to, fromPort: port } : { to });
    }
    return out;
  };
  // …and the sources this file mentions, each once, in first-seen order.
  const moduleNodes = (): string[] => {
    const seen: string[] = [];
    for (const key of Object.keys(modules)) {
      const n = srcId(key);
      if (!seen.includes(n)) seen.push(n);
    }
    return seen;
  };

  // Every edge, recorded on its DESTINATION as the source's out-degree — see docs/graphFile.md.
  const feeders = new Map<string, number[]>();
  const edge = (to: string, srcOutDeg: number): void => {
    const list = feeders.get(to);
    if (list) list.push(srcOutDeg);
    else feeders.set(to, [srcOutDeg]);
  };
  // BARE destinations only, and the out-degree is the SOURCE NODE's — see docs/graphFile.md.
  for (const [key, ds] of Object.entries(modules)) {
    const deg = dests(srcId(key)).length;
    for (const d of ds) if (!splitPort(d).port) edge(d, deg);
  }

  // What feeds each module through a NAMED port, in file order — the wires past the flow, docs/graphFile.md.
  const named = new Map<string, string[]>();
  const feedPort = (from: string, to: string): void => {
    const { node, port } = splitPort(to);
    if (!port) return;
    const list = named.get(node);
    if (list) list.push(from);
    else named.set(node, [from]);
  };
  for (const [m, ds] of Object.entries(modules))
    for (const d of ds) feedPort(srcId(m), d);

  /** Does `n` continue the run that reaches it? Three conditions, and never for a lane — docs/graphFile.md. */
  const absorbed = (n: string): boolean => {
    if (lane(n)) return false;
    const f = feeders.get(n);
    return f?.length === 1 && f[0] === 1 && dests(n).length > 0;
  };

  // A step carries the sources wired to its NAMED ports, beyond the one signal flowing through it.
  const step = (module: string): Step => {
    const extra = named.get(module);
    return {
      module,
      ...(extra?.length ? { in: extra } : {}),
      ...(bypassed.has(module) ? { enabled: false } : {}),
    };
  };
  // A destination keeps BOTH ports, as separate fields because they are separate facts — docs/graphFile.md.
  const outs = (ds: Dest[]): Out[] =>
    ds.map((d) => ({
      to: d.to,
      gain: 1,
      ...(d.fromPort ? { fromPort: d.fromPort } : {}),
    }));

  // Modules already inside a chain — only a cycle needs this, since nothing there is a root.
  const placed = new Set<string>();
  const follow = (start: Dest[]): { use: Step[]; out: Out[] } => {
    const use: Step[] = [];
    let at = start;
    // The walk steps on NODES; a port only ever decorates the edge that got here — docs/graphFile.md.
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

  // The LANES first, claimed whether or not they are wired, named after the SOURCE — docs/graphFile.md.
  for (const n of moduleNodes()) {
    if (!lane(n)) continue;
    placed.add(n);
    const ds = dests(n);
    if (!ds.length) continue; // feeds nothing — the same as not being listed
    const { node } = splitPort(n);
    const port = splitLanes.has(node)
      ? splitPort(n).port
      : soleLanePort.get(node);
    chains[n] = {
      from: node,
      ...(port ? { fromPort: port } : {}),
      ...follow(ds),
    };
  }
  // Then every module starting a run of its own: a bus, the far side of a split, or a node nothing feeds.
  for (const m of moduleNodes()) {
    if (absorbed(m) || placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    chains[m] = { use: [step(m), ...rest.use], out: rest.out };
  }
  // A cycle has no root: breaking it at the first module keeps them visible, and validate() reports it.
  for (const m of moduleNodes()) {
    if (placed.has(m)) continue;
    placed.add(m);
    const rest = follow(dests(m));
    chains[m] = { use: [step(m), ...rest.use], out: rest.out };
  }
  return chains;
}

/** One module wired to nothing at either end — placed but not connected, so wiring checks skip it. */
export function isParked(c: Chain): boolean {
  return !c.from && c.use.length === 1 && !c.out.length;
}

/** The modules a segments file puts the signal through, in order, deduplicated — see docs/graphFile.md. */
export function chainSteps(text: string): string[] {
  const parsed = parseGraph(text);
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
