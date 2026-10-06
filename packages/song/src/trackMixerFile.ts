// trackMixerFile.ts — give a lane the strip an audio track is supposed to have: a `Mixer` module
// of its own, wired at the END of its run, just before the mixer's sum. Split into a PLAN and the
// writes it implies, so a migration's dry run can report what it would do rather than promise it.
// `track new` writes one for a new lane; `scripts/migrateTrackMixer.ts` for every older one.
// See docs/trackMixer.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
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

/** The strip's own file: a NODE on the library's mixer, never a copy of it — see docs/trackMixer.md. */
const mixerNode = (lane: string): string =>
  `# ${lane}'s channel strip: volume, pan and three bands.\n` +
  `#\n` +
  `# This is where the lane's FADER writes — the one on its timeline gutter, the one on its card\n` +
  `# in the graph, and the Mixer view, which are three drawings of this one node. A lane with\n` +
  `# no strip plays at unity and has nowhere to put a level.\n` +
  `extends: ${JSON.stringify(SHARED_STRIP)}\n`;

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

/**
 * Does this lane's run already end on a mixer? Then it has its strip, and everything below is a
 * no-op. Two ways to be one, and BOTH are asked: a node extending the shared strip — what this
 * file writes — and anything that RESOLVES to the Mixer plugin, which is every older strip and
 * every hand-made one. The ref alone is not enough (a project may name the plugin directly); the
 * resolved plugin alone is not either, since it needs the library mounted AND a plugin scan, and a
 * machine with neither would give every `track new` a second strip.
 */
export function hasTrackMixer(g: GraphDoc, lane: string): boolean {
  const c = chainOf(g, lane);
  return !!c?.use.some((s) => {
    const m = g.modules[s.module];
    return m?.plugin?.name === MIXER_PLUGIN || m?.extends === SHARED_STRIP;
  });
}

/**
 * What `lane` needs, or null when it already has a strip. The mixer goes LAST — a level belongs
 * after whatever makes the sound, and `trackMixer` reads the last one in the run.
 *
 * A run that ends anywhere but the sum (a bus, a send, a split) THROWS rather than being guessed
 * at: it is somebody's own arrangement, and splicing a strip into it would rewrite what it means.
 */
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
    const text = readFileSync(join(dir, GRAPH_FILE), "utf8");
    const dests = parseGraph(text).value?.modules?.[prev] ?? [];
    if (!dests.includes(MIX_NODE))
      throw new Error(
        `'${lane}' does not run into ${MIX_NODE} — wire its strip by hand, this would guess`,
      );
  }
  const modules = loadModules(dir);
  const name = mixerNameFor(lane, (n) => n in modules || n in g.chains);
  return { lane, name, rel: `nodes/${name}.yaml`, after: c ? prev : null };
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
    rel: `${CHAINS_DIR}/${chain}.yaml`,
    after: prev,
  };
}

/** The writes a chain project's plan implies: the strip spliced in before the sum, or hung on a run that ended nowhere. */
function applyChainMixer(dir: string, plan: MixerPlan): string[] {
  const after = plan.after ?? plan.lane;
  const item = { id: plan.name, extends: SHARED_STRIP };
  return editChainGraph(
    dir,
    (text) => {
      const dests = parseGraph(text).value?.modules?.[after] ?? [];
      return dests.includes(MIX_NODE)
        ? insertBetween(text, after, MIX_NODE, plan.name)
        : connectNodes(
            insertBetween(text, after, undefined, plan.name),
            plan.name,
            MIX_NODE,
          );
    },
    { add: { [plan.name]: item } },
  );
}

/** The two writes a plan implies: the node's file, and the one arrow in `graph.yaml`. */
export function applyTrackMixer(dir: string, plan: MixerPlan): string[] {
  if (isChainProject(dir)) return applyChainMixer(dir, plan);
  const graphPath = join(dir, GRAPH_FILE);
  const text = readFileSync(graphPath, "utf8");
  const next = plan.after
    ? insertBetween(text, plan.after, MIX_NODE, plan.name)
    : // An orphan lane is not in the graph at all: it and its strip arrive together.
      mergeSegments(text, {
        modules: { [plan.lane]: [plan.name], [plan.name]: [MIX_NODE] },
      });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, plan.rel), mixerNode(plan.lane), "utf8");
  writeFileSync(graphPath, next, "utf8");
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
