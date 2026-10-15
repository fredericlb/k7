// trackChain.ts — `track duplicate` in a chain project: the lane's chain copied as a new `start: true`
// chain, from the lane item on, every item under a FRESH id, links and levels kept. A linked chain fed
// by this one alone is copied too, as the segment version copies a node with one feeder.
// What would be got wrong: a copy never shares an id, nor a preset only its original names.
// See packages/song/docs/chainFiles.md, "Writing to a chain project".

import { copyFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChainProject,
  newNodeId,
  readChainProject,
} from "@studio/song/chainProject";
import { confineTo } from "@studio/song/confine";
import { wsExists, wsWrite } from "@studio/song/yaml/workspaceFile";
import { instanceName } from "@studio/song-schema/instanceName";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  type ChainFile,
  type Item,
  isCallStep,
  isEndStep,
  isTrackItem,
  itemsOf,
  type Step,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";

/** The links out of a chain's own steps to OTHER chains — one naming its own subchain stays inside it. */
const linksOf = (c: ChainFile) => {
  const last = c.steps[c.steps.length - 1];
  const own = new Set((c.subchains ?? []).map((sc) => sc.id));
  return isEndStep(last) ? last.to.filter((l) => !own.has(l.chain)) : [];
};

/** How many items of the project name each explicit `vstpreset:` file. */
function presetUsers(cp: ChainProject): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of Object.values(cp.nodes)) {
    const f = (n.value as { vstpreset?: string }).vstpreset;
    if (f) out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

/** Copy lane `lane`'s chain for `newLane`, whose tracks/ file and chain already exist; the files written. */
export function duplicateLaneChain(
  dir: string,
  lane: string,
  newLane: string,
  taken: (name: string) => boolean,
  claim: (name: string) => string,
): string[] {
  const cp = readChainProject(dir);
  const at = cp.nodes[lane];
  if (!at?.track) return [];
  if (at.item !== null)
    throw new Error(`"${lane}" sits in a side-by-side step — not a lane chain`);

  const incoming = new Map<string, number>();
  for (const c of Object.values(cp.chains))
    for (const l of linksOf(c))
      incoming.set(l.chain, (incoming.get(l.chain) ?? 0) + 1);

  // Which chains are copied, and the name each copy takes: the lane's, then every chain fed by a copy alone.
  const names = new Map<string, string>([[at.chain, newLane]]);
  const queue = [at.chain];
  while (queue.length) {
    const c = cp.chains[queue.shift() as string];
    for (const l of linksOf(c)) {
      const next = cp.chains[l.chain];
      if (!next || names.has(l.chain) || next.start !== undefined) continue;
      if ((incoming.get(l.chain) ?? 0) !== 1) continue;
      names.set(l.chain, claim(instanceName(l.chain, newLane, taken)));
      queue.push(l.chain);
    }
  }

  const users = presetUsers(cp);
  const written: string[] = [];
  for (const [from, to] of names) {
    const src = cp.chains[from];
    const first = from === at.chain ? at.step : 0;
    const ids = new Map<string, string>();
    for (const s of src.steps.slice(first))
      for (const i of itemsOf(s)) ids.set(i.id, newNodeId());
    for (const sc of src.subchains ?? [])
      for (const s of sc.steps)
        for (const i of itemsOf(s)) ids.set(i.id, newNodeId());
    // The source text under the new ids, so formatChain keeps each copied item's own YAML and comments.
    let text = cp.texts[from];
    for (const [o, n] of ids) text = text.split(o).join(n);
    text = text
      .split(`# ${lane}'s channel strip`)
      .join(`# ${newLane}'s channel strip`);
    const parsed = parseChain(text).value;
    if (!parsed) throw new Error(`${CHAINS_DIR}/${from}.yaml: unreadable`);

    const copyItem = (i: Item, old: Item): Item => {
      if (isTrackItem(i)) return { id: i.id, track: newLane };
      const named = (old as { vstpreset?: string }).vstpreset;
      // A preset another item names too is shared on purpose, and the copy shares it.
      if (named && (users.get(named) ?? 0) > 1) return i;
      const file = named ?? `${old.id}.vstpreset`;
      // A name the chain file holds, so it may only read from the project's own presets folder.
      const abs = confineTo(
        [join(dir, VSTPRESETS_DIR)],
        join(dir, VSTPRESETS_DIR, file),
      );
      const own = `${i.id}.vstpreset`;
      if (abs && wsExists(abs)) {
        copyFileSync(abs, join(dir, VSTPRESETS_DIR, own));
        written.push(`${VSTPRESETS_DIR}/${own}`);
      }
      const { vstpreset: _drop, ...rest } = i as Item & { vstpreset?: string };
      return rest as Item;
    };
    // A link naming one of this chain's subchains is to the COPY's subchain of that id: never renamed.
    const own = new Set((src.subchains ?? []).map((sc) => sc.id));
    const copySteps = (next: Step[], prev: Step[]): Step[] =>
      next.map((s, k) => {
        const old = prev[k];
        if (isEndStep(s))
          return {
            to: s.to.map((l) =>
              own.has(l.chain)
                ? l
                : { ...l, chain: names.get(l.chain) ?? l.chain },
            ),
          };
        // A subchain run in place names it by id, and the copy's subchain keeps that id.
        if (isCallStep(s)) return s;
        if (Array.isArray(s))
          return s.map((i, j) => copyItem(i, (old as Item[])[j]));
        return copyItem(s, old as Item);
      });
    const steps = copySteps(parsed.steps.slice(first), src.steps.slice(first));
    const c: ChainFile = { steps };
    if (parsed.subchains?.length)
      c.subchains = parsed.subchains.map((sc, j) => ({
        id: sc.id,
        steps: copySteps(sc.steps, src.subchains?.[j]?.steps ?? []),
      }));
    if (from === at.chain) c.start = true;
    else if (src.ports?.length) c.ports = [...src.ports];
    if (src.bus_only) c.bus_only = true;
    // Written whole even when it reads like its source: the new lane's chain file holds a placeholder.
    wsWrite(join(dir, CHAINS_DIR, `${to}.yaml`), formatChain(c, text));
    written.push(`${CHAINS_DIR}/${to}.yaml`);
  }
  return written;
}
