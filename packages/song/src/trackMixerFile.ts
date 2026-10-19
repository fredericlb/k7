// trackMixerFile.ts — give a lane the strip an audio track is supposed to have: a `Mixer` module
// of its own, wired at the END of its run, just before the mixer's sum. Split into a PLAN and the
// writes it implies, so a migration's dry run can report what it would do rather than promise it.
// `track new` writes one for a new lane; `scripts/migrateTrackMixer.ts` for every older one.
// See docs/trackMixer.md.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { MIX_NODE } from "@studio/song-schema/moduleTypes";
import { CHAINS_DIR } from "@studio/song-schema/yaml/chainSchema";
import {
  connectNodes,
  insertBetween,
  mergeSegments,
  parseGraph,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { chainGraphText, editChainGraph } from "./chainGraphEdit";
import { isChainProject, newNodeId, readChainProject } from "./chainProject";
import type { Chain, GraphDoc } from "./graph";
import { loadModules } from "./loader";
import { SHARED_STRIP } from "./scaffoldLive";
import { wsData, wsText, wsWriteText } from "./yaml/workspaceDoc";

/** The strip's own file: a NODE on the library's mixer, never a copy of it — see docs/trackMixer.md. */
const mixerNode = (lane: string): string =>
  `// ${lane}'s channel strip: volume, pan and three bands.\n` +
  `//\n` +
  `// This is where the lane's FADER writes — the one on its timeline gutter, the one on its card\n` +
  `// in the graph, and the Mixer view, which are three drawings of this one node. A lane with\n` +
  `// no strip plays at unity and has nowhere to put a level.\n` +
  `extends(${JSON.stringify(SHARED_STRIP)})\n`;

/** The destinations a graph's expanded data gives one node. */
const destsIn = (graph: unknown, node: string): string[] =>
  ((graph as { modules?: Record<string, string[]> } | undefined)?.modules?.[
    node
  ] ?? []) as string[];

/** What a lane needs to get its strip: the module to write, and the arrow to splice it into. */
export interface MixerPlan {
  lane: string;
  /** The node name, which is also its folder — one flat key space (docs/trackModules.md). */
  name: string;
  rel: string;
  /** The node the strip goes after, or null when the lane is an ORPHAN and arrives wired with it. */
  after: string | null;
}

/** `mix-<lane>`, then `-2`, `-3`… — the name has to be free across the project's ONE key space. */
export function mixerNameFor(
  lane: string,
  taken: (n: string) => boolean,
): string {
  const base = `mix-${lane}`;
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The chain this lane starts, if any — chains are keyed by their head's resolved name, so it is found by `from`. */
const chainOf = (g: GraphDoc, lane: string): Chain | undefined =>
  Object.values(g.chains).find((c) => c.from === lane);

/** Does this lane's run already hold a strip: a node on the shared strip, or one resolving to the Mixer plugin (docs/trackMixer.md). */
export function hasTrackMixer(g: GraphDoc, lane: string): boolean {
  const c = chainOf(g, lane);
  return !!c?.use.some((s) => {
    const m = g.modules[s.module];
    return m?.plugin?.name === MIXER_PLUGIN || m?.extends === SHARED_STRIP;
  });
}

/** What `lane` needs, the strip LAST in its run, or null when it has one; a run not ending on the sum throws (docs/trackMixer.md). */
export function planTrackMixer(
  dir: string,
  lane: string,
  g: GraphDoc,
): MixerPlan | null {
  if (hasTrackMixer(g, lane)) return null;
  if (isChainProject(dir)) return planChainMixer(dir, lane, g);
  if (!existsSync(join(dir, GRAPH_FILE)))
    throw new Error(`no ${GRAPH_FILE} — a strip has nowhere to be wired`);
  const c = chainOf(g, lane);
  // The node the strip goes AFTER: the run's last module, or the lane itself when nothing follows it.
  const prev = c?.use.length ? c.use[c.use.length - 1].module : lane;
  if (c) {
    const dests = destsIn(wsData(join(dir, GRAPH_FILE)), prev);
    if (!dests.includes(MIX_NODE))
      throw new Error(
        `'${lane}' does not run into ${MIX_NODE} — wire its strip by hand, this would guess`,
      );
  }
  const modules = loadModules(dir);
  const name = mixerNameFor(lane, (n) => n in modules || n in g.chains);
  return { lane, name, rel: `nodes/${name}.k7x`, after: c ? prev : null };
}

/** In a chain project the strip is an item of the lane's chain, named by a fresh id; a run ending nowhere takes it too. */
function planChainMixer(dir: string, lane: string, g: GraphDoc): MixerPlan {
  const c = chainOf(g, lane);
  const prev = c?.use.length ? c.use[c.use.length - 1].module : lane;
  const dests = parseGraph(chainGraphText(dir)).value?.modules?.[prev] ?? [];
  if (dests.length && !dests.includes(MIX_NODE))
    throw new Error(
      `'${lane}' does not run into ${MIX_NODE} — wire its strip by hand, this would guess`,
    );
  const chain = readChainProject(dir).nodes[lane]?.chain ?? lane;
  return {
    lane,
    name: newNodeId(),
    rel: `${CHAINS_DIR}/${chain}.k7x`,
    after: prev,
  };
}

/** The writes a chain project's plan implies: the strip spliced in before the sum, or hung on a run that ended nowhere. */
function applyChainMixer(dir: string, plan: MixerPlan): string[] {
  const after = plan.after ?? plan.lane;
  const item = { id: plan.name, extends: SHARED_STRIP };
  return editChainGraph(
    dir,
    (graph: K7Scope) => {
      if (destsIn(graph.toJS(), after).includes(MIX_NODE))
        insertBetween(graph, after, MIX_NODE, plan.name);
      else {
        insertBetween(graph, after, undefined, plan.name);
        connectNodes(graph, plan.name, MIX_NODE);
      }
    },
    { add: { [plan.name]: item } },
  );
}

/** The two writes a plan implies: the node's file, and the one arrow in `graph.k7x`. */
export function applyTrackMixer(dir: string, plan: MixerPlan): string[] {
  if (isChainProject(dir)) return applyChainMixer(dir, plan);
  const graphPath = join(dir, GRAPH_FILE);
  const doc = new K7Document(wsText(graphPath));
  if (plan.after) insertBetween(doc.at([]), plan.after, MIX_NODE, plan.name);
  // An orphan lane is not in the graph at all: it and its strip arrive together.
  else
    mergeSegments(doc.at([]), {
      modules: { [plan.lane]: [plan.name], [plan.name]: [MIX_NODE] },
    });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  wsWriteText(join(dir, plan.rel), mixerNode(plan.lane));
  wsWriteText(graphPath, doc.toString());
  return [plan.rel, GRAPH_FILE];
}

/** Plan and apply in one, which is what a verb wants; null when the lane already had its strip. */
export function addTrackMixer(
  dir: string,
  lane: string,
  g: GraphDoc,
): string[] | null {
  const plan = planTrackMixer(dir, lane, g);
  return plan ? applyTrackMixer(dir, plan) : null;
}
