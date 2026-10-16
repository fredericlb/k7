// graphDescribe.ts — a GraphDoc as text lines, one chain per line, for `k7 graph` and the
// command bar. Pure: it reads the doc and touches no file. See docs/graphModel.md.

import { splitPort } from "@studio/song-schema/moduleTypes";
import {
  type Chain,
  chainAt,
  type GraphDoc,
  isInputModule,
  isSink,
  type Module,
  type Out,
} from "./graphTypes";

// --- describe (pure) ---------------------------------------------------------

export function describeGraph(g: GraphDoc): string[] {
  const lines: string[] = [];
  // Roots are the chains fed by a track; intermediate nodes have `from` = another chain and are shown via downstream().
  const roots = Object.entries(g.chains).filter(
    ([, c]) => c.from && g.tracks[c.from],
  );

  // Roots plus every chain reachable downstream, so no subbranch is re-listed after a root's trace.
  const reached = new Set<string>();
  const mark = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const o of g.chains[name]?.out ?? []) if (g.chains[o.to]) mark(o.to);
  };
  for (const [name] of roots) mark(name);

  for (const [name, c] of roots) {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    lines.push(head + downstream(g, c.out, new Set([name])));
  }
  // subbranch chains not reached from any root
  for (const [name, c] of Object.entries(g.chains))
    if (!reached.has(name))
      lines.push(
        `${name} (subbranch): ${stepsDesc(g, c) || name}${downstream(g, c.out, new Set([name]))}`,
      );

  return lines;
}

// Resolve a user-supplied track reference (id or display name, case-insensitive) to a track id.
export function resolveTrack(g: GraphDoc, ref: string): string | undefined {
  if (g.tracks[ref]) return ref;
  const lc = ref.toLowerCase();
  for (const [id, t] of Object.entries(g.tracks))
    if (id.toLowerCase() === lc || t.name.toLowerCase() === lc) return id;
  return undefined;
}

// The chains one track feeds, each traced downstream through its steps to the sink — a focused graph display.
export function describeTrackGraph(g: GraphDoc, trackId: string): string[] {
  const roots = Object.entries(g.chains).filter(([, c]) => c.from === trackId);
  if (!roots.length) return [`track '${trackId}' feeds no chains`];
  return roots.map(([name, c]) => {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    return head + downstream(g, c.out, new Set([name]));
  });
}

function trackDesc(g: GraphDoc, from: string): string {
  const t = g.tracks[from];
  if (!t) return g.chains[from] ? `chain '${from}'` : `track '${from}'(?)`;
  const clips = t.placements
    .map((p) => `${p.ref}@${p.start}${p.kind === "missing" ? "(?)" : ""}`)
    .join(", ");
  return `${inputDesc(g, from)}track '${from}' [${clips}]`;
}

// How an io "in" module reads as a node — "in 'guitar'(ch 1) -> ", drawn ahead of the track it feeds; "" when none does.
function inputDesc(g: GraphDoc, trackId: string): string {
  const hit = inputsByTrack(g).get(trackId);
  return hit ? `${nodeDesc(hit[0], hit[1])} -> ` : "";
}

function nodeDesc(name: string, b: Module): string {
  const ch =
    b.channel == null
      ? "?"
      : Array.isArray(b.channel)
        ? b.channel.join("+")
        : `'${b.channel}'`;
  // "auto" is the default and says nothing; off/on are deliberate choices.
  const mon = b.monitor && b.monitor !== "auto" ? ` mon:${b.monitor}` : "";
  return `in '${name}'(ch ${ch}${mon})`;
}

// track id -> the [name, module] of the input feeding it; first one wins, and validate() complains about a second.
function inputsByTrack(g: GraphDoc): Map<string, [string, Module]> {
  const m = new Map<string, [string, Module]>();
  for (const c of Object.values(g.chains)) {
    if (!c.from || m.has(c.from)) continue;
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      m.set(c.from, [s.module, b]);
      break;
    }
  }
  return m;
}

// A chain's steps as "module -> module(bypassed) -> …", minus the io "in" step inputDesc already drew as the source.
function stepsDesc(g: GraphDoc, c: Chain): string {
  return c.use
    .filter((s) => !isInputModule(g, g.modules[s.module] ?? ({} as Module)))
    .map((s) => `${s.module}${s.enabled === false ? "(bypassed)" : ""}`)
    .join(" -> ");
}

// A gain suffix shown only when the signal is attenuated ("@30%"); the full-signal case stays bare.
const gainTag = (gain: number): string =>
  gain === 1 ? "" : `@${Math.round(gain * 100)}%`;

function downstream(g: GraphDoc, out: Out[], seen: Set<string>): string {
  if (!out.length) return "";
  const parts = out.map((o) => {
    const tag = gainTag(o.gain);
    const { node, port } = splitPort(o.to);
    if (isSink(g, node)) return o.to + tag; // e.g. OUT
    if (seen.has(node)) return `${o.to}${tag}(cycle)`;
    // A port destination lands mid-run, so it is traced from the chain HOSTING that step and named by the jack.
    const next = chainAt(g, o.to);
    const c = next ? g.chains[next] : undefined;
    if (!c) return `${o.to}${tag}(?)`;
    const head = port ? o.to : stepsDesc(g, c) || node;
    return `${head + tag}${downstream(g, c.out, new Set([...seen, node]))}`;
  });
  return ` -> ${parts.join(" + ")}`;
}
