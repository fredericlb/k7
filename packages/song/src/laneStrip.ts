// laneStrip.ts — every lane's STRIP, sound and picture alike: one node LAST in the lane's run, just
// before the sum it ends on (MIX, or RENDER for a picture lane). One planner, one writer, one finder
// and one back-fill for both kinds; only the module and the sum differ (STRIPS). Split into a PLAN
// and its writes, so a migration's dry run can report what it would do rather than promise it.
// See docs/trackMixer.md and docs/videoMixer.md.

import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import {
  MIX_NODE,
  PICTURE_STRIP,
  RENDER_NODE,
} from "@studio/song-schema/moduleTypes";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import { CHAINS_DIR, isEndStep } from "@studio/song-schema/yaml/chainSchema";
import {
  connectNodes,
  insertBetween,
  mergeSegments,
  parseGraph,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { chainGraphText, editChainGraph } from "./chainGraphEdit";
import {
  chainFilePath,
  isChainProject,
  newNodeId,
  readChainProject,
} from "./chainProject";
import { type GraphDoc, loadGraph } from "./graph";
import { createPictureLaneFile, loadModules } from "./loader";
import { SHARED_STRIP } from "./scaffoldLive";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

type Module = GraphDoc["modules"][string];

/** What a strip IS for each kind of lane: the module it extends, the sum its run ends on, what it carries. */
const STRIPS = {
  audio: {
    ref: SHARED_STRIP,
    sink: MIX_NODE,
    holds: "volume, pan and three bands",
    // A module resolving to the engine's Mixer is a strip too, whatever it extends.
    is: (m: Module | undefined) =>
      m?.plugin?.name === MIXER_PLUGIN || m?.extends === SHARED_STRIP,
  },
  picture: {
    ref: PICTURE_STRIP,
    sink: RENDER_NODE,
    holds: "red, green, blue and transparency",
    is: (m: Module | undefined) => m?.extends === PICTURE_STRIP,
  },
} as const;

export type StripKind = keyof typeof STRIPS;

/** A picture lane's strip is the shader; anything else a lane can be is heard, so its strip is the Mixer. */
const kindOf = (g: GraphDoc, lane: string): StripKind =>
  g.videoTracks?.[lane] ? "picture" : "audio";

/** The strip's own file: a NODE on k7's shipped strip, never a copy of it — see docs/trackMixer.md. */
const stripNode = (kind: StripKind, lane: string): string =>
  `// ${lane}'s channel strip: ${STRIPS[kind].holds}.\n` +
  `//\n` +
  `// This is where the lane's level and look are written — its card in the graph, its row in the\n` +
  `// per-track view and the Mixer view are drawings of this one node.\n` +
  `extends(${JSON.stringify(STRIPS[kind].ref)})\n`;

/** What a lane needs to get its strip: the module to write, and the node it goes after. */
export interface StripPlan {
  lane: string;
  kind: StripKind;
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

/** A name `mixerNameFor` made for `lane` — so it may follow the lane's on a rename. */
const isLaneMixerName = (name: string, lane: string): boolean => {
  const base = `mix-${lane}`;
  return (
    name === base ||
    (name.startsWith(`${base}-`) && /^\d+$/.test(name.slice(base.length + 1)))
  );
};

/** The modules of the run this lane starts, in order — chains are keyed by their head, so it is found by `from`. */
const runOf = (g: GraphDoc, lane: string): string[] =>
  Object.values(g.chains)
    .find((c) => c.from === lane)
    ?.use.map((s) => s.module) ?? [];

/** Is this node a strip, of either kind. */
export const isLaneStrip = (g: GraphDoc, node: string): boolean =>
  STRIPS.audio.is(g.modules[node]) || STRIPS.picture.is(g.modules[node]);

/** The lane's strip, the LAST of its kind in its run (a run may pass through more than one), or null. */
export function laneStrip(g: GraphDoc, lane: string): string | null {
  const is = STRIPS[kindOf(g, lane)].is;
  return (
    runOf(g, lane)
      .filter((m) => is(g.modules[m]))
      .at(-1) ?? null
  );
}

/** Does this lane's run already hold its strip. */
export const hasLaneStrip = (g: GraphDoc, lane: string): boolean =>
  laneStrip(g, lane) !== null;

/** The strip a lane OWNS: in a chain project the one in its run, elsewhere only one bearing the name `mixerNameFor` gave it. */
export function ownLaneStrip(
  dir: string,
  g: GraphDoc,
  lane: string,
): string | null {
  const strip = laneStrip(g, lane);
  if (!strip) return null;
  return isChainProject(dir) || isLaneMixerName(strip, lane) ? strip : null;
}

/** Each of these lanes' strips, by lane — what the graph pins as the lane's face. */
export function laneStripsOf(
  g: GraphDoc,
  lanes: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lane of lanes) {
    const strip = laneStrip(g, lane);
    if (strip) out[lane] = strip;
  }
  return out;
}

/** What `lane` needs, its strip LAST in its run, or null when it has one; a run ending on another sum throws (docs/trackMixer.md). */
export function planLaneStrip(
  dir: string,
  lane: string,
  g: GraphDoc,
): StripPlan | null {
  if (laneStrip(g, lane)) return null;
  const kind = kindOf(g, lane);
  const { sink } = STRIPS[kind];
  const run = runOf(g, lane);
  // The node the strip goes AFTER: the run's last module, or the lane itself when nothing follows it.
  const prev = run.length ? run[run.length - 1] : lane;
  const chained = isChainProject(dir);
  const graphPath = join(dir, GRAPH_FILE);
  const modules = chained
    ? (parseGraph(chainGraphText(dir)).value?.modules ?? {})
    : existsSync(graphPath)
      ? (parseGraph(wsText(graphPath)).value?.modules ?? {})
      : {};
  const dests = modules[prev] ?? [];
  if (dests.length && !dests.includes(sink))
    throw new Error(
      `'${lane}' does not run into ${sink} — wire its strip by hand, this would guess`,
    );
  if (chained) {
    const chain = readChainProject(dir).nodes[prev]?.chain ?? lane;
    return {
      lane,
      kind,
      name: newNodeId(),
      rel: `${CHAINS_DIR}/${chain}.k7x`,
      after: prev,
    };
  }
  const nodes = loadModules(dir);
  const name = mixerNameFor(lane, (n) => n in nodes || n in g.chains);
  return {
    lane,
    kind,
    name,
    rel: `nodes/${name}.k7x`,
    after: prev in modules ? prev : null,
  };
}

/** The strip on the arrow into the sum, or hung on a run that led nowhere and wired on to it. */
function spliceStrip(
  graph: K7Scope,
  after: string,
  name: string,
  sink: string,
) {
  const dests =
    (graph.toJS() as { modules?: Record<string, string[]> }).modules?.[after] ??
    [];
  if (dests.includes(sink)) insertBetween(graph, after, sink, name);
  else {
    insertBetween(graph, after, undefined, name);
    connectNodes(graph, name, sink);
  }
}

/** In ONE chain file, the item right after `after`, when the file's only way out is the sum — else null. */
function insertInChainFile(dir: string, plan: StripPlan, sink: string) {
  const at = plan.after && readChainProject(dir).nodes[plan.after];
  if (!at || at.sub || at.item !== null) return null;
  const path = chainFilePath(dir, at.chain);
  const doc = new K7Document(wsText(path));
  const steps = doc.getIn(["steps"]);
  if (!Array.isArray(steps)) return null;
  // Only past the run's LAST item, and only where nothing but the sum leaves: a send stays before the strip.
  const rest = steps.slice(at.step + 1);
  if (!rest.every(isEndStep)) return null;
  const links = rest.flatMap((s) => (isEndStep(s) ? s.to : []));
  if (links.some((l) => l.chain !== sink || l.port)) return null;
  doc.insertIn(["steps"], at.step + 1, {
    id: plan.name,
    extends: STRIPS[plan.kind].ref,
  });
  if (!links.length) doc.addIn(["steps"], { to: [{ chain: sink }] });
  const parsed = parseChain(doc.toString());
  if (!parsed.value) return null;
  wsWriteText(path, formatChain(parsed.value, doc.toString()));
  return [relative(dir, path)];
}

/** The writes a plan implies: one chain file where it can, else the whole graph; a node file and an arrow in graph.k7x. */
export function applyLaneStrip(dir: string, plan: StripPlan): string[] {
  const { sink, ref } = STRIPS[plan.kind];
  if (isChainProject(dir)) {
    // Targeted first: the whole-graph rewrite folds a fade's stretch into its lane (docs/videoMixer.md).
    const one = insertInChainFile(dir, plan, sink);
    if (one) return one;
    const after = plan.after ?? plan.lane;
    return editChainGraph(
      dir,
      (graph) => spliceStrip(graph, after, plan.name, sink),
      {
        add: { [plan.name]: { id: plan.name, extends: ref } },
      },
    );
  }
  const graphPath = join(dir, GRAPH_FILE);
  // A project with no graph.k7x yet gets one: the lane needs none, but its strip has to be wired.
  const doc = new K7Document(existsSync(graphPath) ? wsText(graphPath) : "");
  if (plan.after) spliceStrip(doc.at([]), plan.after, plan.name, sink);
  // An orphan lane is not in the graph at all: it and its strip arrive together.
  else
    mergeSegments(doc.at([]), {
      modules: { [plan.lane]: [plan.name], [plan.name]: [sink] },
    });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  wsWriteText(join(dir, plan.rel), stripNode(plan.kind, plan.lane));
  wsWriteText(graphPath, doc.toString());
  return [plan.rel, GRAPH_FILE];
}

/** Plan and apply in one, which is what a verb wants; null when the lane already had its strip. */
export function addLaneStrip(
  dir: string,
  lane: string,
  g: GraphDoc,
): string[] | null {
  const plan = planLaneStrip(dir, lane, g);
  return plan ? applyLaneStrip(dir, plan) : null;
}

/** A lane just made gets its strip; one that cannot be wired is SAID in `noStrip`, never refused for. */
export function stripNewLane(
  dir: string,
  lane: string,
): { written: string[]; noStrip: string } {
  try {
    return {
      written: addLaneStrip(dir, lane, loadGraph(dir)) ?? [],
      noStrip: "",
    };
  } catch (e) {
    return { written: [], noStrip: (e as Error).message };
  }
}

/** A new picture lane WITH its strip — every place a picture lane is made goes through here. */
export function createPictureLane(
  dir: string,
  id: string,
): { written: string[]; noStrip: string } {
  const written = createPictureLaneFile(dir, id);
  const strip = stripNewLane(dir, id);
  return { written: [...written, ...strip.written], noStrip: strip.noStrip };
}

/** Every listed lane lacking a strip gets one — the back-fill; a DRY pass plans and writes nothing. */
export function stripLanes(
  dir: string,
  pick: (g: GraphDoc) => string[],
  opts: { dry?: boolean } = {},
): { planned: StripPlan[]; written: string[]; warnings: string[] } {
  const planned: StripPlan[] = [];
  const written: string[] = [];
  const warnings: string[] = [];
  let g = loadGraph(dir);
  for (const lane of pick(g))
    try {
      const plan = planLaneStrip(dir, lane, g);
      if (!plan) continue;
      planned.push(plan);
      if (opts.dry) continue;
      written.push(...applyLaneStrip(dir, plan));
      // Re-read only after a write: the next plan must see this strip.
      g = loadGraph(dir);
    } catch (e) {
      warnings.push(`${lane}: ${(e as Error).message}`);
    }
  return { planned, written, warnings };
}

/** The lanes a back-fill covers: every sound lane, every picture lane, or both. */
export const soundLanes = (g: GraphDoc): string[] => Object.keys(g.tracks);
export const pictureLanes = (g: GraphDoc): string[] =>
  Object.keys(g.videoTracks ?? {});
