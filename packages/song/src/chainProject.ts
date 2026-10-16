// chainProject.ts — a project kept as `chains/*.yaml`, read into and written back from the SEGMENT
// graph everything downstream already reads. A node's in-memory name is its lane name or its id.
// The two directions must round-trip: a graph edit is a transform over segments, written back here.
// What would be got wrong: a chain without a start that nothing links is hidden, unless it is PLACED.
// See docs/chainFiles.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAIN_SINKS,
  CHAINS_DIR,
  type ChainFile,
  calledSubchains,
  type EndStep,
  expandCalls,
  type Item,
  isEndStep,
  isVideoTrackItem,
  itemsOf,
  LAYOUT_FILE,
  type Link,
  laneOfItem,
  type Step,
  stepLists,
} from "@studio/song-schema/yaml/chainSchema";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { parse, stringify } from "yaml";
import {
  type ChainUnit,
  chainUnits,
  nestSubchains,
  regroupCalls,
  resolveLink,
  splitKey,
  subKey,
} from "./chainScope";
import {
  isDocName,
  realPath,
  wsExists,
  wsIssues,
  wsRead,
  wsRemove,
  wsWrite,
} from "./yaml/workspaceFile";

/** One node as the loader sees it: where it sits, and what it says. */
export interface ChainNode {
  name: string;
  id: string;
  chain: string;
  /** The subchain of `chain` it sits in, absent for the chain's own steps. */
  sub?: string;
  step: number;
  /** Its index in a parallel step; null for a step holding one item. */
  item: number | null;
  /** The lane it IS, of either kind — an audio lane's file is in `tracks/`, a picture lane's in `video_tracks/`. */
  track?: string;
  /** Set on a PICTURE lane: it holds no module, and its placements are not in `tracks/`. */
  picture?: true;
  /** The item as written — module fields plus `id`, `bypass`, `vstpreset`, `mapping`. */
  value: Item;
}

export interface ChainProject {
  chains: Record<string, ChainFile>;
  /** The chains marked `hidden`, set aside whole: no node of theirs is in `nodes`, and no writer rewrites them. */
  hidden?: Record<string, ChainFile>;
  /** Each chain file's text as read, so a rewrite keeps its comments (formatChain). */
  texts: Record<string, string>;
  nodes: Record<string, ChainNode>;
  issues: string[];
}

type Positions = NonNullable<GraphFile["positions"]>;

const SINKS = new Set<string>(CHAIN_SINKS);

/** Its presence IS the format: a project with `chains/` is read from it, and never from graph.yaml. */
export function isChainProject(dir: string): boolean {
  const d = join(dir, CHAINS_DIR);
  return wsExists(d) && statSync(d).isDirectory();
}

/** The name a node is known by in memory, in commands and on the wire: its lane, else its id. */
export const nameOfItem = (i: Item): string => laneOfItem(i) ?? i.id;

/** The file chain `chain` is read from and written to: `.k7x`, else `.yaml`, else `.yml`; `.yaml` for a new one. */
export function chainFilePath(dir: string, chain: string): string {
  const base = join(dir, CHAINS_DIR, chain);
  const yaml = realPath(`${base}.yaml`);
  const yml = realPath(`${base}.yml`);
  return existsSync(yaml) || !existsSync(yml) ? yaml : yml;
}

/** Every chain file, parsed; a file that fails is reported and left out rather than half-read. */
export function readChainProject(dir: string): ChainProject {
  const out: ChainProject = { chains: {}, texts: {}, nodes: {}, issues: [] };
  const folder = join(dir, CHAINS_DIR);
  if (!wsExists(folder)) return out;
  // By chain NAME, each read once from chainFilePath, since `x.k7x` and `x.yaml` are one chain.
  const names = new Set<string>();
  for (const f of readdirSync(folder)) {
    const m = /^(.+)\.(?:ya?ml|k7x)$/i.exec(f);
    if (m && isDocName(f)) names.add(m[1]);
  }
  // `polysynth-copy` sorts before `polysynth` by file name but not by chain name, and lanes follow this order.
  for (const name of [...names].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0))) {
    const file = chainFilePath(dir, name);
    const f = basename(file);
    const text = wsRead(file);
    const { value, issues } = parseChain(text);
    for (const i of wsIssues(file, issues))
      out.issues.push(
        `${CHAINS_DIR}/${f}${i.line ? `:${i.line}:${i.col}` : ""}: ${i.path ? `${i.path}: ` : ""}${i.message}`,
      );
    if (!value) continue;
    // A hidden chain is not part of the project as compiled: its lane, its nodes and its links are all left out.
    if (value.hidden) {
      out.hidden = { ...out.hidden, [name]: value };
      continue;
    }
    out.chains[name] = value;
    out.texts[name] = text;
    for (const { sub, steps } of stepLists(value))
      steps.forEach((step, s) => {
        const items = itemsOf(step);
        items.forEach((it, k) => {
          const n = nameOfItem(it);
          if (out.nodes[n])
            out.issues.push(
              `${CHAINS_DIR}/${f}: "${n}" is already a node of chain "${out.nodes[n].chain}"`,
            );
          out.nodes[n] = {
            name: n,
            id: it.id,
            chain: name,
            ...(sub ? { sub } : {}),
            step: s,
            item: Array.isArray(step) ? k : null,
            ...(laneOfItem(it) ? { track: laneOfItem(it) } : {}),
            ...(isVideoTrackItem(it) ? { picture: true as const } : {}),
            value: it,
          };
        });
      });
  }
  return out;
}

export function readLayout(dir: string): Positions {
  const f = join(dir, LAYOUT_FILE);
  if (!wsExists(f)) return {};
  const raw = parse(wsRead(f))?.positions;
  return raw && typeof raw === "object" ? (raw as Positions) : {};
}

export function writeLayout(dir: string, positions: Positions): void {
  const f = join(dir, LAYOUT_FILE);
  if (!Object.keys(positions).length) {
    if (wsExists(f)) wsRemove(f);
    return;
  }
  const flow = Object.fromEntries(Object.entries(positions));
  const text = stringify(
    { positions: flow },
    { lineWidth: 0, flowCollectionPadding: true },
  )
    // One card per line: a move is a one-line diff.
    .replace(
      /^ {2}(\S.*):\n {4}x: (.+)\n {4}y: (.+)$/gm,
      "  $1: { x: $2, y: $3 }",
    );
  wsWrite(f, text);
}

/** The picture lane a chain file's own steps hold, if any — its subchains may be fade STRETCHES. */
export const pictureLaneOf = (c: ChainFile | undefined): string | undefined =>
  c?.steps.flatMap(itemsOf).find(isVideoTrackItem)?.video_track;

const endOf = (c: ChainFile): EndStep | undefined => {
  const s = c.steps[c.steps.length - 1];
  return isEndStep(s) ? s : undefined;
};

/** The chain files as segments: one `modules:` map, the bypass list, the buses, and each link's level. */
export function toSegments(
  cp: ChainProject,
  positions: Positions = {},
): { graph: GraphFile; levels: Record<string, number> } {
  const modules: Record<string, string[]> = {};
  const levels: Record<string, number> = {};
  const bypassed: string[] = [];
  const busOnly: string[] = [];
  // Subchains are chains like the others here, under a scoped key their parent's links resolve to.
  const units = chainUnits(cp.chains);
  const byKey = new Map(units.map((u) => [u.key, u]));
  const linked = new Set<string>();
  for (const u of units)
    for (const l of endOf(u.chain)?.to ?? []) {
      const k = resolveLink(cp.chains, u, l.chain);
      if (k) linked.add(k);
    }
  // A rack node's taps routed to subchains of its own file: each such subchain is FED by that tap (docs/racks.md).
  const tapFeeds: { node: string; tap: string; to: string }[] = [];
  for (const u of units)
    for (const s of u.chain.steps)
      for (const item of itemsOf(s)) {
        const outs = (item as { tap_outs?: unknown }).tap_outs;
        if (!outs || typeof outs !== "object") continue;
        for (const [tap, sub] of Object.entries(
          outs as Record<string, unknown>,
        )) {
          const key =
            typeof sub === "string"
              ? resolveLink(cp.chains, u, sub)
              : undefined;
          const target = key ? byKey.get(key) : undefined;
          // Only a subchain that is not run in place: one called as a step has no run of its own to be fed.
          if (
            !key ||
            !target?.sub ||
            calledSubchains(cp.chains[target.parent]).has(target.sub)
          )
            continue;
          const first = target.chain.steps.find((x) => !isEndStep(x));
          if (!first) continue;
          tapFeeds.push({
            node: nameOfItem(item),
            tap,
            to: nameOfItem(itemsOf(first)[0]),
          });
          linked.add(key);
        }
      }

  // Where a link LANDS: a chain's first node (`#port` when named), a built-in end, or nothing.
  const targetsOf = (from: ChainUnit, l: Link, seen: Set<string>): string[] => {
    const key = resolveLink(cp.chains, from, l.chain);
    const u = key ? byKey.get(key) : undefined;
    if (key && !u) return [key];
    if (!u || seen.has(u.key)) return [];
    const first = u.chain.steps[0];
    if (!first || isEndStep(first)) {
      // A chain of links only passes its input straight on.
      seen.add(u.key);
      return (endOf(u.chain)?.to ?? []).flatMap((x) => targetsOf(u, x, seen));
    }
    const head = nameOfItem(itemsOf(first)[0]);
    return [l.port ? `${head}#${l.port}` : head];
  };

  for (const u of units) {
    // A subchain RUN in place is a stretch of its parent, compiled there and not again on its own.
    if (u.sub && calledSubchains(cp.chains[u.parent]).has(u.sub)) continue;
    const c = u.chain;
    const steps = u.sub ? c.steps : expandCalls(c);
    // A picture lane's subchain that nothing links and that links nowhere is a fade's STRETCH: it lands on the lane.
    const stretchTo =
      u.sub && !linked.has(u.key) && !endOf(c)
        ? pictureLaneOf(cp.chains[u.parent])
        : undefined;
    const visible =
      c.start !== undefined ||
      linked.has(u.key) ||
      !!stretchTo ||
      steps.some((s) => itemsOf(s).some((i) => positions[nameOfItem(i)]));
    if (!visible) continue;
    const nodeSteps = steps
      .filter((s) => !isEndStep(s))
      .map((s) => itemsOf(s).map(nameOfItem));
    const links = endOf(c)?.to ?? [];
    const ends = stretchTo
      ? [{ t: stretchTo, level: undefined }]
      : links.flatMap((l) =>
          targetsOf(u, l, new Set([u.key])).map((t) => ({
            t,
            level: l.level,
          })),
        );
    const from = typeof c.start === "string" ? [c.start] : [];
    const seq = [from, ...nodeSteps].filter((s) => s.length);
    seq.forEach((names, i) => {
      const next = seq[i + 1];
      for (const n of names) {
        if (next) modules[n] = [...next];
        else {
          modules[n] = ends.map((e) => e.t);
          for (const e of ends)
            if (e.level !== undefined) levels[`${n}>${e.t}`] = e.level;
        }
      }
    });
    for (const s of steps)
      for (const i of itemsOf(s)) if (i.bypass) bypassed.push(nameOfItem(i));
    if (c.bus_only && nodeSteps[0]) busOnly.push(nodeSteps[0][0]);
  }
  const graph: GraphFile = { modules };
  if (bypassed.length) graph.bypassed = bypassed;
  if (busOnly.length) graph.bus_only = busOnly;
  if (tapFeeds.length) graph.tap_feeds = tapFeeds;
  if (Object.keys(positions).length) graph.positions = positions;
  return { graph, levels };
}

export interface FromSegmentsOptions {
  /** A node's item as it should be written — the existing one, or one built for a migrated node. */
  itemOf: (name: string) => Item;
  /** Whether a node with nothing feeding it STARTS a chain (a lane, an input) rather than sitting loose. */
  isSource: (name: string) => boolean;
  /** The chains as they were, so a rewrite keeps their names and their links' levels. */
  prev?: ChainProject;
  levels?: Record<string, number>;
  /** A name for a chain no previous chain owned, from its head node. */
  nameFor?: (head: string, taken: Set<string>) => string;
  /** Nodes written though nothing in `modules` names them — kept as loose chains, hidden. */
  loose?: string[];
  /** Chain names a new chain must not take: files this rewrite leaves alone. */
  reserved?: string[];
  /** Whether a node is a PASS over a picture — what a fade's stretch is made of; absent, no run is one. */
  isPicturePass?: (name: string) => boolean;
}

const bare = (d: string) => d.split("#")[0];
const portOf = (d: string) =>
  d.includes("#") ? d.slice(d.indexOf("#") + 1) : undefined;

/** Segments back into chain files: runs break where the signal splits or meets, and a diamond is a parallel step. */
export function fromSegments(
  graph: GraphFile,
  o: FromSegmentsOptions,
): Record<string, ChainFile> {
  // The STRETCHES first, and the rest of the walk never sees them: else the lane is absorbed into the run feeding it.
  const stretches = stretchRuns(graph.modules ?? {}, o);
  const inStretch = new Set(stretches.flatMap((r) => r.nodes));
  const modules = Object.fromEntries(
    Object.entries(graph.modules ?? {}).filter(([n]) => !inStretch.has(n)),
  );
  const bypassed = new Set(graph.bypassed ?? []);
  const busOnly = new Set(graph.bus_only ?? []);
  const levels = o.levels ?? {};
  const preds = new Map<string, string[]>();
  const portIn = new Set<string>();
  for (const [from, dests] of Object.entries(modules))
    for (const d of dests) {
      const b = bare(d);
      if (!preds.has(b)) preds.set(b, []);
      preds.get(b)?.push(from);
      if (portOf(d)) portIn.add(b);
    }
  const predsOf = (n: string) => preds.get(n) ?? [];
  const destsOf = (n: string) => modules[n] ?? [];
  const isSum = (n: string) => n === "MIX" || n === "RENDER";
  const isNode = (n: string) => !SINKS.has(n) && !isSum(n);

  // A node heads a chain unless exactly one node feeds it, by its main input, and feeds nothing else.
  const isHead = (n: string): boolean => {
    if (portIn.has(n)) return true;
    const p = predsOf(n);
    if (p.length !== 1) return true;
    return destsOf(p[0]).length !== 1 || isSum(p[0]);
  };

  // a → [b1..bk] → d, each bi fed by a alone and feeding d alone, d fed by them alone: one parallel step.
  const diamond = (a: string): { mids: string[]; join: string } | null => {
    const ds = destsOf(a);
    if (ds.length < 2 || ds.some((d) => portOf(d) || !isNode(d))) return null;
    const outs = ds.map(destsOf);
    if (outs.some((x) => x.length !== 1 || portOf(x[0]))) return null;
    const join = outs[0][0];
    if (!isNode(join) || outs.some((x) => x[0] !== join)) return null;
    if (ds.some((d) => predsOf(d).length !== 1)) return null;
    const jp = predsOf(join);
    if (jp.length !== ds.length || jp.some((p) => !ds.includes(p))) return null;
    if (ds.some((d) => laneOfItem(o.itemOf(d)))) return null;
    return { mids: ds, join };
  };

  // A node that sat in a subchain names the scoped key, so its run is written back into that parent.
  // …but one RUN in place is a stretch of its parent's run, so it names the parent (regroupCalls).
  const prevChainOf = (n: string) => {
    const was = o.prev?.nodes[n];
    const parent = was && o.prev?.chains[was.chain];
    if (!was?.sub || (parent && calledSubchains(parent).has(was.sub)))
      return was?.chain;
    return subKey(was.chain, was.sub);
  };
  const taken = new Set<string>(o.reserved ?? []);
  const chainName = new Map<string, string>();
  const nameFor =
    o.nameFor ??
    ((head: string, t: Set<string>) => {
      let n = head;
      for (let i = 2; t.has(n); i++) n = `${head}-${i}`;
      return n;
    });

  const heads: string[] = [];
  for (const s of ["MIX", "RENDER"]) if (modules[s]) heads.push(s);
  const inDiamond = new Set<string>();
  for (const a of Object.keys(modules)) {
    const dm = diamond(a);
    if (dm) for (const m of [...dm.mids, dm.join]) inDiamond.add(m);
  }
  for (const n of Object.keys(modules))
    if (isNode(n) && isHead(n) && !inDiamond.has(n)) heads.push(n);
  for (const n of o.loose ?? [])
    if (!modules[n] && !heads.includes(n)) heads.push(n);
  // A lane a stretch lands on needs a chain to hold it, wired or not.
  for (const r of stretches)
    if (!modules[r.lane] && !heads.includes(r.lane)) heads.push(r.lane);

  // The first answer `pick` gives along a run, head first, following it while it is one node after another.
  const alongRun = (
    h: string,
    pick: (n: string) => string | undefined,
  ): string | undefined => {
    const seen = new Set<string>();
    for (let cur: string | undefined = h; cur && !seen.has(cur); ) {
      seen.add(cur);
      const found = pick(cur);
      if (found) return found;
      const ds = destsOf(cur);
      cur =
        ds.length === 1 && isNode(ds[0]) && !portOf(ds[0]) && !isHead(ds[0])
          ? ds[0]
          : undefined;
    }
    return undefined;
  };
  // The lane a run holds, when it holds one: a chain that is a lane is named after it.
  const laneIn = (h: string): string | undefined =>
    alongRun(h, (n) => laneOfItem(o.itemOf(n)));
  // The subchain a run's nodes came from, so a node put at its head does not lift it out of its parent.
  const subIn = (h: string): string | undefined =>
    alongRun(h, (n) => {
      const k = prevChainOf(n);
      return k?.includes("/") ? k : undefined;
    });

  // Names first, so a link can name a chain that is written later.
  for (const h of heads) {
    const prev = isSum(h)
      ? Object.entries(o.prev?.chains ?? {}).find(([, c]) => c.start === h)?.[0]
      : (prevChainOf(h) ?? subIn(h));
    // A run holding a lane is that lane's chain, whatever chain its head came from.
    const lane = isSum(h) ? undefined : laneIn(h);
    const want =
      lane && !taken.has(lane)
        ? lane
        : prev && !taken.has(prev)
          ? prev
          : nameFor(
              isSum(h)
                ? h === "MIX"
                  ? "master"
                  : "picture"
                : (laneIn(h) ?? h),
              taken,
            );
    taken.add(want);
    chainName.set(h, want);
  }

  const item = (n: string): Item => {
    const it = { ...o.itemOf(n) } as Item & { bypass?: boolean };
    if (bypassed.has(n)) it.bypass = true;
    else delete it.bypass;
    return it;
  };

  const out: Record<string, ChainFile> = {};
  for (const h of heads) {
    const steps: Step[] = [];
    const seen = new Set<string>();
    let cur = h;
    if (!isSum(h)) {
      steps.push(item(h));
      seen.add(h);
    }
    for (;;) {
      const dm = diamond(cur);
      if (dm && !seen.has(dm.join)) {
        steps.push(dm.mids.map(item));
        steps.push(item(dm.join));
        for (const m of dm.mids) seen.add(m);
        seen.add(dm.join);
        cur = dm.join;
        continue;
      }
      const ds = destsOf(cur);
      if (
        ds.length === 1 &&
        isNode(ds[0]) &&
        !portOf(ds[0]) &&
        !isHead(ds[0]) &&
        !seen.has(ds[0])
      ) {
        cur = ds[0];
        steps.push(item(cur));
        seen.add(cur);
        continue;
      }
      const links: Link[] = ds.map((d) => {
        const b = bare(d);
        const l: Link = { chain: isNode(b) ? (chainName.get(b) ?? b) : b };
        const port = portOf(d);
        if (port) l.port = port;
        const lv = levels[`${cur}>${d}`];
        if (lv !== undefined) l.level = lv;
        return l;
      });
      if (links.length > 1) for (const l of links) l.level ??= 1;
      if (links.length) steps.push({ to: links });
      break;
    }
    const c: ChainFile = { steps };
    if (isSum(h)) c.start = h as "MIX" | "RENDER";
    else if (predsOf(h).length === 0 && o.isSource(h)) c.start = true;
    else {
      const ports = [
        ...new Set(
          Object.values(modules)
            .flat()
            .filter((d) => bare(d) === h)
            .map(portOf)
            .filter((p): p is string => !!p),
        ),
      ];
      if (ports.length) c.ports = ports;
    }
    if (!isSum(h) && busOnly.has(h)) c.bus_only = true;
    out[chainName.get(h) as string] = c;
  }
  // Each stretch becomes a subchain of the chain holding its lane, under the id it had or one from its head.
  const laneChain = new Map<string, string>();
  for (const h of heads) {
    const lane = isSum(h) ? undefined : laneIn(h);
    if (lane) laneChain.set(lane, chainName.get(h) as string);
  }
  for (const r of stretches) {
    const parent = laneChain.get(r.lane);
    if (!parent) continue;
    const was = prevChainOf(r.nodes[0]);
    const prevSub =
      was && splitKey(was).parent === parent ? splitKey(was).sub : undefined;
    let id = prevSub ?? stretchId(o.itemOf(r.nodes[0]), r.nodes[0]);
    for (let i = 2; out[subKey(parent, id)]; i++)
      id = `${prevSub ?? stretchId(o.itemOf(r.nodes[0]), r.nodes[0])}-${i}`;
    out[subKey(parent, id)] = { steps: r.nodes.map(item) };
  }
  return regroupCalls(nestSubchains(out), o.prev);
}

/** A stretch's subchain id when it had none: the leaf of what its head extends, as a chain is named. */
function stretchId(head: Item, name: string): string {
  const ext = (head as { extends?: unknown }).extends;
  const leaf = (typeof ext === "string" ? ext : name).split("/").pop() ?? name;
  return leaf.replace(/^@/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "stretch";
}

/** Each STRETCH in the segments: a series of nodes nothing feeds, none a source, whose only way out is a picture lane. */
function stretchRuns(
  modules: Record<string, string[]>,
  o: FromSegmentsOptions,
): { lane: string; nodes: string[] }[] {
  const fed = new Map<string, number>();
  for (const ds of Object.values(modules))
    for (const d of ds) fed.set(bare(d), (fed.get(bare(d)) ?? 0) + 1);
  const end = (n: string) =>
    SINKS.has(n) || n === "MIX" || n === "RENDER" || !(n in modules);
  // Asked only of a NODE: a writer's `itemOf` may have nothing to say about a sink or a name it never saw.
  const itemOf = (n: string): Item | undefined => {
    try {
      return o.itemOf(n);
    } catch {
      return undefined;
    }
  };
  const out: { lane: string; nodes: string[] }[] = [];
  const pass = o.isPicturePass;
  if (!pass) return out;
  for (const h of Object.keys(modules)) {
    if (fed.has(h) || end(h) || o.isSource(h) || !pass(h)) continue;
    const nodes = [h];
    for (let cur = h; ; ) {
      const ds = modules[cur] ?? [];
      if (ds.length !== 1 || portOf(ds[0])) break;
      const d = ds[0];
      if (!SINKS.has(d) && isVideoTrackItem(itemOf(d))) {
        out.push({ lane: d, nodes });
        break;
      }
      if (end(d) || fed.get(d) !== 1 || nodes.includes(d) || !pass(d)) break;
      nodes.push(d);
      cur = d;
    }
  }
  return out;
}

/** Write every chain that changed and remove the files of chains that are gone. */
export function writeChainProject(
  dir: string,
  chains: Record<string, ChainFile>,
  prevTexts: Record<string, string> = {},
): void {
  const folder = join(dir, CHAINS_DIR);
  mkdirSync(folder, { recursive: true });
  for (const [name, c] of Object.entries(chains)) {
    const text = formatChain(c, prevTexts[name] ?? "");
    if (text !== prevTexts[name]) wsWrite(chainFilePath(dir, name), text);
  }
  for (const name of Object.keys(prevTexts))
    if (!chains[name]) {
      for (const ext of [".yaml", ".yml"]) {
        const f = join(folder, `${name}${ext}`);
        if (wsExists(f)) wsRemove(f);
      }
    }
}

/** A fresh node id — every node written gets one, and a copy gets a new one (docs/chainFiles.md). */
export const newNodeId = (): string => randomUUID();

/** Each link's level keyed `<from>><to>` as `toSegments` spells it — empty for a project of segments. */
export function loadLinkLevels(dir: string): Record<string, number> {
  if (!isChainProject(dir)) return {};
  return toSegments(readChainProject(dir), readLayout(dir)).levels;
}
