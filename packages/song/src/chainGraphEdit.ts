// chainGraphEdit.ts — a graph edit on a chain project: the chain files read as segments, the SAME
// text transform a `graph.yaml` gets, and the result written back as chain files and `layout.yaml`.
// What would be got wrong: a node the result no longer names is KEPT, as a loose chain, unless the
// caller says it is dropped — a hidden chain is absent from the segments it is edited through.
// See docs/chainFiles.md.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  isIoSource,
  isPicturePass,
  SHAPE_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import { formatChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAIN_SINKS,
  CHAINS_DIR,
  type ChainFile,
  type Item,
  itemsOf,
  laneOfItem,
  stepLists,
  TRACKS_DIR,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { YAML_READ, YAML_WRITE } from "@studio/song-schema/yaml/yamlText";
import { parse, stringify } from "yaml";
import {
  type ChainProject,
  fromSegments,
  nameOfItem,
  readChainProject,
  readLayout,
  toSegments,
  writeLayout,
} from "./chainProject";
import { loadModuleRefs, loadModules } from "./loader";
import { resolveModule } from "./moduleResolve";
import {
  wsExists,
  wsRead,
  wsRemove,
  wsRename,
  wsWrite,
} from "./yaml/workspaceFile";

const SINKS = new Set<string>([...CHAIN_SINKS, "MIX", "RENDER"]);
const bare = (d: string) => d.split("#")[0];

/** The chain project as the segments text a `graph.yaml` would hold — what every graph transform reads. */
export function chainGraphText(dir: string): string {
  const cp = readChainProject(dir);
  return stringify(toSegments(cp, readLayout(dir)).graph, YAML_WRITE);
}

/** A name a caller may use for a node: the node itself, or a chain holding that one node alone. */
export function chainNodeName(
  dir: string,
  name: string,
  cp = readChainProject(dir),
): string {
  if (cp.nodes[name] || SINKS.has(bare(name))) return name;
  const c = cp.chains[bare(name)];
  const items = c ? c.steps.flatMap(itemsOf) : [];
  if (items.length !== 1) return name;
  const port = name.includes("#") ? name.slice(name.indexOf("#")) : "";
  return `${laneOfItem(items[0]) ?? items[0].id}${port}`;
}

export interface ChainGraphEdit {
  /** Items the transform brings in that no chain holds yet, keyed by their in-memory name. */
  add?: Record<string, Item>;
  /** Nodes the transform takes out that are to be DELETED rather than kept loose. */
  drop?: string[];
  /** A lane renamed by the transform: its item, chain, link levels and layout key follow. */
  rename?: { from: string; to: string };
}

// Whether a node with nothing feeding it starts a chain: a lane, a node that already did, or an input.
function sourceTest(dir: string, cp: ChainProject, items: (n: string) => Item) {
  let resolved: ((n: string) => unknown) | null = null;
  return (n: string): boolean => {
    if (laneOfItem(items(n))) return true;
    const was = cp.nodes[n];
    if (
      was &&
      !was.sub &&
      was.step === 0 &&
      cp.chains[was.chain]?.start === true
    )
      return true;
    resolved ??= (() => {
      const mods = loadModules(dir);
      const refs = loadModuleRefs(dir);
      return (x: string) =>
        mods[x] ? resolveModule(mods[x], refs) : undefined;
    })();
    const m = resolved(n) as { io?: unknown; category?: unknown } | undefined;
    // A SHAPE is a picture source too, drawn rather than filmed (song-video/docs/shapes.md).
    return isIoSource(m?.io) || m?.category === SHAPE_CATEGORY;
  };
}

// Whether a node is a picture pass, resolved once and only if asked — what a fade's stretch is made of.
function passTest(dir: string) {
  let resolved: ((n: string) => unknown) | null = null;
  return (n: string): boolean => {
    resolved ??= (() => {
      const mods = loadModules(dir);
      const refs = loadModuleRefs(dir);
      return (x: string) =>
        mods[x] ? resolveModule(mods[x], refs).category : undefined;
    })();
    return isPicturePass(resolved(n) as string | undefined);
  };
}

// A new chain's name: a lane's own, else the leaf of what the head extends, free among the chains.
function nameForOf(items: (n: string) => Item) {
  return (head: string, taken: Set<string>): string => {
    let it: Item | undefined;
    try {
      it = items(head);
    } catch {
      it = undefined;
    }
    const ext =
      it && !laneOfItem(it)
        ? (it as Record<string, unknown>).extends
        : undefined;
    const base =
      typeof ext === "string" ? (ext.split("/").pop() ?? head) : head;
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base}-${i}`;
    return n;
  };
}

// The project re-keyed for a lane rename, so the chain and the item follow the name.
function renamed(cp: ChainProject, from: string, to: string): ChainProject {
  const nodes = { ...cp.nodes };
  const n = nodes[from];
  if (n) {
    delete nodes[from];
    nodes[to] = {
      ...n,
      name: to,
      track: to,
      value: { ...n.value, track: to } as Item,
    };
  }
  const chains = { ...cp.chains };
  const texts = { ...cp.texts };
  if (n && n.chain === from && !chains[to]) {
    chains[to] = chains[from];
    texts[to] = texts[from];
    delete chains[from];
    delete texts[from];
    for (const k of Object.keys(nodes))
      if (nodes[k].chain === from) nodes[k] = { ...nodes[k], chain: to };
  }
  return { ...cp, nodes, chains, texts };
}

const swap = (s: string, from: string, to: string): string =>
  s === from
    ? to
    : s.startsWith(`${from}#`)
      ? `${to}${s.slice(from.length)}`
      : s;

/** Run a `graph.yaml` text transform over a chain project and write the result back — the files changed. */
export function editChainGraph(
  dir: string,
  transform: (text: string) => string,
  opts: ChainGraphEdit = {},
): string[] {
  const read = readChainProject(dir);
  if (read.issues.length)
    throw new Error(
      `the chains do not read — fix them first:\n  ${read.issues.join("\n  ")}`,
    );
  const positions = readLayout(dir);
  const { graph, levels } = toSegments(read, positions);
  const text = stringify(graph, YAML_WRITE);
  const next = transform(text);
  if (next === text) return [];
  const parsed = parseGraph(next);
  if (!parsed.value)
    throw new Error(
      `a graph edit went wrong: ${parsed.issues[0]?.message ?? "unreadable"}`,
    );
  const result: GraphFile = parsed.value;

  const r = opts.rename;
  const cp = r ? renamed(read, r.from, r.to) : read;
  const lv = r
    ? Object.fromEntries(
        Object.entries(levels).map(([k, v]) => {
          const [a, b] = k.split(">");
          return [`${swap(a, r.from, r.to)}>${swap(b, r.from, r.to)}`, v];
        }),
      )
    : levels;
  const add = opts.add ?? {};
  const raw = rawItems(cp);
  const itemOf = (n: string): Item => {
    const was = cp.nodes[n];
    const it =
      add[n] ??
      (was && {
        ...(raw.get(was.id) ?? was.value),
        ...(r && n === r.to
          ? was.picture
            ? { video_track: r.to }
            : { track: r.to }
          : {}),
      });
    if (!it) throw new Error(`'${n}' is not a node of this project`);
    return it;
  };
  const named = new Set(Object.keys(result.modules ?? {}));
  for (const ds of Object.values(result.modules ?? {}))
    for (const d of ds) named.add(bare(d));
  const drop = new Set(opts.drop ?? []);
  // A chain the graph did not show and the edit does not name is left as it is: rewritten, its nodes would come back one loose chain each.
  const shown = new Set(Object.keys(graph.modules ?? {}));
  for (const ds of Object.values(graph.modules ?? {}))
    for (const d of ds) shown.add(bare(d));
  const asleep = new Set(
    Object.entries(cp.chains)
      .filter(([, c]) => {
        const ns = stepLists(c)
          .flatMap((l) => l.steps.flatMap(itemsOf))
          .map(nameOfItem);
        return (
          ns.length > 0 &&
          ns.every((n) => !shown.has(n) && !named.has(n) && !drop.has(n))
        );
      })
      .map(([name]) => name),
  );
  const asleepNodes = new Set(
    Object.values(cp.nodes)
      .filter((n) => asleep.has(n.chain))
      .map((n) => n.name),
  );
  const loose = [...Object.keys(cp.nodes), ...Object.keys(add)].filter(
    (n) => !named.has(n) && !drop.has(n) && !asleepNodes.has(n),
  );
  const chains = fromSegments(result, {
    itemOf,
    isSource: sourceTest(dir, cp, itemOf),
    isPicturePass: passTest(dir),
    prev: cp,
    levels: lv,
    loose,
    nameFor: nameForOf(itemOf),
    // …and a new chain takes neither its name nor a hidden chain's, whose files this leaves alone too.
    reserved: [...asleep, ...Object.keys(cp.hidden ?? {})],
  });
  const written = writeChains(dir, chains, cp.texts, asleep);
  const pos = result.positions ?? {};
  if (stringify(pos) !== stringify(positions)) {
    writeLayout(dir, pos);
    written.push("layout.yaml");
  }
  return written;
}

// Every item as WRITTEN, by id: the parsed value lists the schema's keys first, and a rewrite must not reorder.
function rawItems(cp: ChainProject): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const text of Object.values(cp.texts)) {
    const file = parse(text, YAML_READ) as {
      steps?: unknown[];
      subchains?: { steps?: unknown[] }[];
    } | null;
    const lists = [
      file?.steps,
      ...(file?.subchains ?? []).map((sc) => sc?.steps),
    ];
    for (const steps of lists)
      for (const s of steps ?? [])
        for (const i of Array.isArray(s) ? s : [s])
          if (i && typeof i === "object" && typeof (i as Item).id === "string")
            out.set((i as Item).id, i as Item);
  }
  return out;
}

/** Write each chain whose text differs from the file on disk, and remove the files of chains gone. */
function writeChains(
  dir: string,
  chains: Record<string, ChainFile>,
  prevTexts: Record<string, string>,
  keep: ReadonlySet<string> = new Set(),
): string[] {
  const folder = join(dir, CHAINS_DIR);
  mkdirSync(folder, { recursive: true });
  const out: string[] = [];
  const onDisk = (name: string): string | undefined => {
    for (const ext of [".yaml", ".yml"]) {
      const f = join(folder, `${name}${ext}`);
      if (wsExists(f)) return wsRead(f);
    }
    return undefined;
  };
  for (const [name, c] of Object.entries(chains)) {
    const text = formatChain(c, prevTexts[name] ?? onDisk(name) ?? "");
    if (text === onDisk(name)) continue;
    rmSync(join(folder, `${name}.yml`), { force: true });
    wsWrite(join(folder, `${name}.yaml`), text);
    out.push(`${CHAINS_DIR}/${name}.yaml`);
  }
  for (const name of Object.keys(readChainProject(dir).chains))
    if (!chains[name] && !keep.has(name))
      for (const ext of [".yaml", ".yml"]) {
        const f = join(folder, `${name}${ext}`);
        if (wsExists(f)) {
          wsRemove(f);
          out.push(`${CHAINS_DIR}/${name}${ext}`);
        }
      }
  return out;
}

/** Rename a LANE: its file in `tracks/`, its item's `track`, and every trace of it in the chains. */
export function renameChainLane(
  dir: string,
  from: string,
  to: string,
  transform: (text: string) => string,
): string[] {
  const src = join(dir, TRACKS_DIR, `${from}.yaml`);
  const dest = join(dir, TRACKS_DIR, `${to}.yaml`);
  if (wsExists(dest))
    throw new Error(
      `${TRACKS_DIR}/${to}.yaml already exists — refusing to overwrite`,
    );
  const written = editChainGraph(dir, transform, { rename: { from, to } });
  if (wsExists(src)) wsRename(src, dest);
  return [`${TRACKS_DIR}/${from}.yaml → ${TRACKS_DIR}/${to}.yaml`, ...written];
}

/** Delete a node from a chain project — its item, a lane's file, and its preset when nobody else names it. */
export function deleteChainItem(
  dir: string,
  node: string,
  transform: (text: string) => string,
): string[] {
  const cp = readChainProject(dir);
  const n = cp.nodes[node];
  if (!n) throw new Error(`no node '${node}' in this project`);
  editChainGraph(dir, transform, { drop: [node] });
  const removed = [`${CHAINS_DIR}/${n.chain}.yaml: ${node}`];
  if (n.track) {
    const f = join(dir, TRACKS_DIR, `${n.track}.yaml`);
    if (wsExists(f)) {
      wsRemove(f);
      removed.push(`${TRACKS_DIR}/${n.track}.yaml`);
    }
    return removed;
  }
  // Only the default-named state goes: a named `vstpreset:` may be shared on purpose.
  const own = `${n.id}.vstpreset`;
  const named = (n.value as { vstpreset?: string }).vstpreset;
  const others = Object.values(cp.nodes).some(
    (o) =>
      o.name !== node && (o.value as { vstpreset?: string }).vstpreset === own,
  );
  const f = join(dir, VSTPRESETS_DIR, own);
  if ((!named || named === own) && !others && wsExists(f)) {
    rmSync(f);
    removed.push(`${VSTPRESETS_DIR}/${own}`);
  }
  return removed;
}
