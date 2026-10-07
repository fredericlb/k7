// chainScope.ts — SUBCHAINS: a chain file's own chains, reached only from inside that file. In memory
// a subchain is a chain like the others, keyed `<parent>/<id>` (no file name holds a `/`), and a link
// resolves inside its parent's scope first. Written back, a derived chain under such a key returns
// to its parent while the scope still holds, and becomes a chain of its own when an edit breaks it.
// See docs/chainFiles.md, "Subchains".

import {
  CHAIN_SINKS,
  type ChainFile,
  calledSubchains,
  type EndStep,
  type Item,
  isEndStep,
  isTrackItem,
  itemsOf,
  type Step,
  type Subchain,
} from "@studio/song-schema/yaml/chainSchema";

const SINKS = new Set<string>(CHAIN_SINKS);

/** A chain as the compile walks it: a file's own steps, or one of its subchains under a scoped key. */
export interface ChainUnit {
  key: string;
  /** The FILE's chain — itself for a top-level chain. */
  parent: string;
  /** The subchain's id inside `parent`, absent for the file's own steps. */
  sub?: string;
  chain: ChainFile;
}

/** The key a subchain is known by in memory. */
export const subKey = (parent: string, sub: string): string =>
  `${parent}/${sub}`;

/** Split a key back into its file chain and subchain id; a top-level key has no `sub`. */
export function splitKey(key: string): { parent: string; sub?: string } {
  const at = key.indexOf("/");
  return at < 0
    ? { parent: key }
    : { parent: key.slice(0, at), sub: key.slice(at + 1) };
}

/** Every chain of the project, each file's subchains right after it. */
export function chainUnits(chains: Record<string, ChainFile>): ChainUnit[] {
  const out: ChainUnit[] = [];
  for (const [name, c] of Object.entries(chains)) {
    out.push({ key: name, parent: name, chain: c });
    for (const sc of c.subchains ?? [])
      out.push({
        key: subKey(name, sc.id),
        parent: name,
        sub: sc.id,
        chain: { steps: sc.steps },
      });
  }
  return out;
}

/** What a link out of `from` names: a sibling subchain first, then (from a file's own steps) a chain or an end. */
export function resolveLink(
  chains: Record<string, ChainFile>,
  from: ChainUnit,
  name: string,
): string | null {
  const own = chains[from.parent]?.subchains?.some((sc) => sc.id === name);
  if (own) return subKey(from.parent, name);
  if (SINKS.has(name) && !chains[name]) return name;
  // Closed both ways: a subchain reaches nothing outside its parent but a built-in end.
  if (from.sub) return SINKS.has(name) ? name : null;
  return chains[name] ? name : null;
}

const endOf = (steps: Step[]): EndStep | undefined => {
  const s = steps[steps.length - 1];
  return isEndStep(s) ? s : undefined;
};

/** Each derived `<parent>/<id>` chain back into its parent while its scope holds, else renamed free — docs/chainFiles.md. */
export function nestSubchains(
  out: Record<string, ChainFile>,
): Record<string, ChainFile> {
  const keys = Object.keys(out).filter((k) => splitKey(k).sub);
  const feeders = new Map<string, Set<string>>();
  for (const [name, c] of Object.entries(out))
    for (const l of endOf(c.steps)?.to ?? []) {
      if (!feeders.has(l.chain)) feeders.set(l.chain, new Set());
      feeders.get(l.chain)?.add(name);
    }
  // Lifted out one at a time, since a sibling lifted out is "outside" for the ones linking to it.
  const nested = new Set(keys);
  const inScope = (k: string, parent: string): boolean =>
    k === parent || (nested.has(k) && splitKey(k).parent === parent);
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of [...nested]) {
      const { parent } = splitKey(k);
      const c = out[k];
      const ok =
        !!out[parent] &&
        !splitKey(parent).sub &&
        c.start === undefined &&
        !c.ports?.length &&
        !c.bus_only &&
        [...(feeders.get(k) ?? [])].every((f) => inScope(f, parent)) &&
        (endOf(c.steps)?.to ?? []).every(
          (l) => SINKS.has(l.chain) || inScope(l.chain, parent),
        );
      if (!ok) {
        nested.delete(k);
        changed = true;
      }
    }
  }

  // A chain lifted out takes a free top-level name: `<parent>-<id>`, numbered past any taken.
  const rename = new Map<string, string>();
  const taken = new Set(Object.keys(out).filter((k) => !splitKey(k).sub));
  for (const k of keys) {
    const { parent, sub } = splitKey(k);
    if (nested.has(k)) rename.set(k, sub as string);
    else {
      let n = `${parent}-${sub}`;
      for (let i = 2; taken.has(n); i++) n = `${parent}-${sub}-${i}`;
      taken.add(n);
      rename.set(k, n);
    }
  }
  const relink = (steps: Step[]): Step[] =>
    steps.map((s) =>
      isEndStep(s)
        ? {
            to: s.to.map((l) => ({
              ...l,
              chain: rename.get(l.chain) ?? l.chain,
            })),
          }
        : s,
    );

  const result: Record<string, ChainFile> = {};
  for (const [name, c] of Object.entries(out)) {
    if (splitKey(name).sub) {
      if (!nested.has(name))
        result[rename.get(name) as string] = { ...c, steps: relink(c.steps) };
      continue;
    }
    const subs: Subchain[] = keys
      .filter((k) => nested.has(k) && splitKey(k).parent === name)
      .map((k) => ({
        id: rename.get(k) as string,
        steps: relink(out[k].steps),
      }));
    result[name] = {
      ...c,
      steps: relink(c.steps),
      ...(subs.length ? { subchains: subs } : {}),
    };
    if (!subs.length) delete result[name].subchains;
  }
  return result;
}

/** What `regroupCalls` needs of the project as it was: where each node sat, and each file's chain. */
export interface PrevPlaces {
  nodes: Record<string, { chain: string; sub?: string }>;
  chains: Record<string, ChainFile>;
}

const nameOf = (i: Item): string => (isTrackItem(i) ? i.track : i.id);

/** Each stretch of a run whose nodes sat in a subchain RUN in place goes back into it, as a `{ sub }` step. */
export function regroupCalls(
  out: Record<string, ChainFile>,
  prev?: PrevPlaces,
): Record<string, ChainFile> {
  if (!prev) return out;
  const called = new Map<string, Set<string>>();
  const callOf = (name: string): string | undefined => {
    const n = prev.nodes[name];
    if (!n?.sub || !prev.chains[n.chain]) return undefined;
    if (!called.has(n.chain))
      called.set(n.chain, calledSubchains(prev.chains[n.chain]));
    return called.get(n.chain)?.has(n.sub) ? n.sub : undefined;
  };
  // The subchain a step's nodes ALL sat in; a step mixing two places belongs to none.
  const groupOf = (s: Step): string | undefined => {
    const subs = itemsOf(s).map((i) => callOf(nameOf(i)));
    return subs.length && subs.every((x) => x && x === subs[0])
      ? subs[0]
      : undefined;
  };
  const isNew = (s: Step): boolean => {
    const items = itemsOf(s);
    return !!items.length && items.every((i) => !prev.nodes[nameOf(i)]);
  };

  const result: Record<string, ChainFile> = {};
  for (const [name, c] of Object.entries(out)) {
    const subs: Subchain[] = [...(c.subchains ?? [])];
    const used = new Set(subs.map((sc) => sc.id));
    const steps: Step[] = [];
    let changed = false;
    for (let i = 0; i < c.steps.length; ) {
      const id = groupOf(c.steps[i]);
      // Never the first step: that one is a node, its ports what the chain is linked into.
      if (!id || i === 0 || used.has(id)) {
        steps.push(c.steps[i++]);
        continue;
      }
      // A node inserted between two of its members joins the stretch, as one put inside it would.
      const group: Step[] = [];
      while (i < c.steps.length) {
        const s = c.steps[i];
        const inside =
          groupOf(s) === id ||
          (isNew(s) &&
            i + 1 < c.steps.length &&
            groupOf(c.steps[i + 1]) === id);
        if (!inside) break;
        group.push(s);
        i++;
      }
      steps.push({ sub: id });
      subs.push({ id, steps: group });
      used.add(id);
      changed = true;
    }
    result[name] = changed ? { ...c, steps, subchains: subs } : c;
  }
  return result;
}
