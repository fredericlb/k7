// tapChain.ts — a tap's SUBCHAIN, edited from the tap: add a module (the first one creating the subchain and routing
// the tap to it), remove one, move one. The last one removed takes the subchain with it and puts the tap back on
// the main output, since a tap-fed subchain with no node feeds nothing. Written straight into the node's chain file,
// one write per edit, never through a graph rewrite. See packages/song/docs/racks.md.

import { join } from "node:path";
import {
  nameOfItem,
  newNodeId,
  readChainProject,
} from "@studio/song/chainProject";
import { loadModuleRefs } from "@studio/song/loader";
import { wsExists, wsWrite } from "@studio/song/yaml/workspaceFile";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAIN_SINKS,
  CHAINS_DIR,
  type ChainFile,
  type Item,
  isEndStep,
  itemsOf,
  type Step,
} from "@studio/song-schema/yaml/chainSchema";
import { tapsOf } from "./rackTaps";

type Subchain = NonNullable<ChainFile["subchains"]>[number];
type Outs = Record<string, string>;

const SINKS = new Set<string>(CHAIN_SINKS);

/** Where the edit lands: the node's chain file, cloned, and the node's own item inside the clone. */
function open(dir: string, node: string, tap: string) {
  const cp = readChainProject(dir);
  if (cp.issues.length)
    throw new Error(
      `the chains do not read — fix them first:\n  ${cp.issues.join("\n  ")}`,
    );
  const at = cp.nodes[node];
  if (!at) throw new Error(`no node '${node}' in this project`);
  if (!tapsOf(dir, node).includes(tap))
    throw new Error(`'${node}' has no tap '${tap}'`);
  const file = structuredClone(cp.chains[at.chain]);
  const steps = at.sub
    ? file.subchains?.find((s) => s.id === at.sub)?.steps
    : file.steps;
  const step = steps?.[at.step];
  const item = (Array.isArray(step) ? step[at.item ?? 0] : step) as Item & {
    tap_outs?: Outs;
  };
  if (!item) throw new Error(`'${node}' is not where its chain file says`);
  const sub = file.subchains?.find((s) => s.id === item.tap_outs?.[tap]);
  return { cp, chain: at.chain, file, item, sub };
}

/** Check the edited file still reads, then write it — the project-relative path. */
function write(
  dir: string,
  cp: ReturnType<typeof readChainProject>,
  chain: string,
  file: ChainFile,
): string {
  const text = formatChain(file, cp.texts[chain]);
  const read = parseChain(text);
  if (!read.value)
    throw new Error(
      `the edit would make ${chain} unreadable — ${read.issues[0]?.message ?? ""}`,
    );
  const yml = join(dir, CHAINS_DIR, `${chain}.yml`);
  wsWrite(wsExists(yml) ? yml : join(dir, CHAINS_DIR, `${chain}.yaml`), text);
  return `${CHAINS_DIR}/${chain}.yaml`;
}

/** The node steps of a subchain, its trailing `to:` left out. */
const nodeSteps = (sub: Subchain): Step[] =>
  sub.steps.filter((s) => !isEndStep(s));

const stepHolds = (s: Step, id: string) =>
  !isEndStep(s) && itemsOf(s).some((i) => nameOfItem(i) === id);

/** A subchain id free in `file`, after the tap: `snare-fx`, then `snare-fx-2`… */
function freeId(file: ChainFile, tap: string): string {
  const base = `${tap.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}-fx`;
  const taken = new Set((file.subchains ?? []).map((s) => s.id));
  let id = base;
  for (let i = 2; taken.has(id) || SINKS.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Add a node of module `ref` at the end of the tap's subchain — made, and the tap routed to it, when there is none. */
export function addTapChainNode(
  dir: string,
  node: string,
  tap: string,
  ref: string,
): { subchain: string; id: string } {
  const m = loadModuleRefs(dir)[ref];
  if (!m || m.node || m.engineOf)
    throw new Error(`'${ref}' is not a module this project can see`);
  if (m.kind === "io")
    throw new Error(`'${ref}' is an io module — a tap's chain holds effects`);
  const { cp, chain, file, item, sub } = open(dir, node, tap);
  const added = { id: newNodeId(), extends: ref } as Item;
  if (sub) {
    // Before the trailing link, so the new node is the last one the tap goes through.
    const end = sub.steps.findIndex(isEndStep);
    sub.steps.splice(end < 0 ? sub.steps.length : end, 0, added);
    write(dir, cp, chain, file);
    return { subchain: sub.id, id: added.id };
  }
  const id = freeId(file, tap);
  file.subchains = [
    ...(file.subchains ?? []),
    { id, steps: [added, { to: [{ chain: "MIX" }] }] },
  ];
  item.tap_outs = { ...(item.tap_outs ?? {}), [tap]: id };
  write(dir, cp, chain, file);
  return { subchain: id, id: added.id };
}

/** Remove one node of the tap's subchain; the last one takes the subchain with it and the tap back to the main output. */
export function removeTapChainNode(
  dir: string,
  node: string,
  tap: string,
  id: string,
): { emptied: boolean } {
  const { cp, chain, file, item, sub } = open(dir, node, tap);
  if (!sub)
    throw new Error(`'${node}': tap '${tap}' is not routed to a subchain`);
  const at = sub.steps.findIndex((s) => stepHolds(s, id));
  if (at < 0) throw new Error(`no node '${id}' in subchain '${sub.id}'`);
  const step = sub.steps[at];
  if (Array.isArray(step) && step.length > 1)
    sub.steps[at] = step.filter((i) => nameOfItem(i) !== id) as Step;
  else sub.steps.splice(at, 1);
  const emptied = nodeSteps(sub).length === 0;
  if (emptied) {
    file.subchains = (file.subchains ?? []).filter((s) => s.id !== sub.id);
    if (!file.subchains.length) delete file.subchains;
    const outs = { ...(item.tap_outs ?? {}) };
    delete outs[tap];
    if (Object.keys(outs).length) item.tap_outs = outs;
    else delete item.tap_outs;
  }
  write(dir, cp, chain, file);
  return { emptied };
}

/** Move one node of the tap's subchain `by` places (-1 earlier, +1 later), kept inside its nodes. */
export function moveTapChainNode(
  dir: string,
  node: string,
  tap: string,
  id: string,
  by: number,
): void {
  const { cp, chain, file, sub } = open(dir, node, tap);
  if (!sub)
    throw new Error(`'${node}': tap '${tap}' is not routed to a subchain`);
  const nodes = nodeSteps(sub);
  const from = nodes.findIndex((s) => stepHolds(s, id));
  if (from < 0) throw new Error(`no node '${id}' in subchain '${sub.id}'`);
  const to = Math.max(0, Math.min(nodes.length - 1, from + by));
  if (to === from) return;
  const [moved] = nodes.splice(from, 1);
  nodes.splice(to, 0, moved);
  sub.steps = [...nodes, ...sub.steps.filter(isEndStep)];
  write(dir, cp, chain, file);
}
