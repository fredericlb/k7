// pictureMixerFile.ts — give a picture lane its STRIP: a `video-mixer` node LAST in the lane's own run,
// ahead of wherever that run leads, and on to RENDER when it led nowhere. Planned, then applied, as the
// audio strip is (trackMixerFile.ts), so the back-fill on open writes only what a lane lacks.
// See docs/videoMixer.md.

import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { PICTURE_STRIP, RENDER_NODE } from "@studio/song-schema/moduleTypes";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import { CHAINS_DIR, isEndStep } from "@studio/song-schema/yaml/chainSchema";
import {
  connectNodes,
  disconnectNodes,
  insertBetween,
  mergeSegments,
  parseGraph,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import {
  chainFilePath,
  isChainProject,
  newNodeId,
  readChainProject,
} from "./chainProject";
import { type GraphDoc, loadGraph } from "./graph";
import { createPictureLaneFile, loadModules } from "./loader";
import { mixerNameFor } from "./trackMixerFile";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

/** A graph project's strip file: a NODE on the shipped strip, never a copy of it. */
const stripNode = (lane: string): string =>
  `// ${lane}'s picture strip: red, green, blue and transparency.\n` +
  `extends(${JSON.stringify(PICTURE_STRIP)})\n`;

/** What a picture lane needs to get its strip: the node, the file it lands in, and the node it follows. */
export interface PictureMixerPlan {
  lane: string;
  name: string;
  rel: string;
  /** The run's last module, or the lane itself when its run holds none. */
  after: string;
}

/** The modules of the run this lane starts, in order — empty when nothing follows the lane. */
const runOf = (g: GraphDoc, lane: string): string[] =>
  Object.values(g.chains)
    .find((c) => c.from === lane)
    ?.use.map((s) => s.module) ?? [];

/** Does this lane's run already hold a strip — a node on the shipped one. */
export function hasPictureMixer(g: GraphDoc, lane: string): boolean {
  return runOf(g, lane).some((m) => g.modules[m]?.extends === PICTURE_STRIP);
}

/** Each picture lane's strip node, the LAST in its run as the audio strip is — what the graph pins as the lane's face. */
export function pictureStripsOf(g: GraphDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lane of Object.keys(g.videoTracks)) {
    const strip = runOf(g, lane)
      .filter((m) => g.modules[m]?.extends === PICTURE_STRIP)
      .at(-1);
    if (strip) out[lane] = strip;
  }
  return out;
}

/** What `lane` needs, or null when it has its strip or is no picture lane. */
export function planPictureMixer(
  dir: string,
  lane: string,
  g: GraphDoc,
): PictureMixerPlan | null {
  if (!g.videoTracks[lane] || hasPictureMixer(g, lane)) return null;
  const run = runOf(g, lane);
  const after = run.length ? run[run.length - 1] : lane;
  if (isChainProject(dir)) {
    const chain = readChainProject(dir).nodes[after]?.chain ?? lane;
    return {
      lane,
      name: newNodeId(),
      rel: `${CHAINS_DIR}/${chain}.k7x`,
      after,
    };
  }
  const modules = loadModules(dir);
  const name = mixerNameFor(
    `video-${lane}`,
    (n) => n in modules || n in g.chains,
  );
  return { lane, name, rel: `nodes/${name}.k7x`, after };
}

/** Splice `name` after `after`, taking over every arrow it had; a run that led nowhere now leads to RENDER. */
function splice(graph: K7Scope, after: string, name: string): void {
  const dests = (graph.toJS() as { modules?: Record<string, string[]> })
    .modules?.[after];
  if (!dests?.length) {
    insertBetween(graph, after, undefined, name);
    connectNodes(graph, name, RENDER_NODE);
    return;
  }
  insertBetween(graph, after, dests[0], name);
  for (const d of dests.slice(1)) {
    disconnectNodes(graph, after, d);
    connectNodes(graph, name, d);
  }
}

/** A chain project's write: ONE file, the item right after the run's last, and `to RENDER` where the chain had no way out. */
function applyChainStrip(dir: string, plan: PictureMixerPlan): string[] {
  // Targeted, never a whole-graph rewrite: that one folds a fade's stretch into its lane (docs/videoMixer.md).
  const at = readChainProject(dir).nodes[plan.after];
  if (!at) throw new Error(`no node '${plan.after}' in a chain`);
  if (at.sub || at.item !== null)
    throw new Error(
      `'${plan.after}' sits inside a subchain or a parallel step — wire the strip by hand`,
    );
  const path = chainFilePath(dir, at.chain);
  const doc = new K7Document(wsText(path));
  const steps = doc.getIn(["steps"]);
  if (!Array.isArray(steps)) throw new Error(`${at.chain} has no steps`);
  doc.insertIn(["steps"], at.step + 1, {
    id: plan.name,
    extends: PICTURE_STRIP,
  });
  if (!steps.some(isEndStep))
    doc.addIn(["steps"], { to: [{ chain: RENDER_NODE }] });
  const out = doc.toString();
  const parsed = parseChain(out);
  if (!parsed.value)
    throw new Error(
      `the strip would make ${at.chain} unreadable — ${parsed.issues[0]?.message ?? ""}`.trim(),
    );
  wsWriteText(path, formatChain(parsed.value, out));
  return [relative(dir, path)];
}

/** The writes a plan implies: a chain item in a chain project, a node file and an arrow in a graph one. */
export function applyPictureMixer(
  dir: string,
  plan: PictureMixerPlan,
): string[] {
  if (isChainProject(dir)) return applyChainStrip(dir, plan);
  const graphPath = join(dir, GRAPH_FILE);
  // A project with no graph.k7x yet gets one: a picture lane needs none, but its strip has to be wired.
  const doc = new K7Document(existsSync(graphPath) ? wsText(graphPath) : "");
  const root = doc.at([]);
  // A picture lane need not be in graph.k7x at all: it and its strip arrive together.
  const known = parseGraph(doc.toString()).value?.modules ?? {};
  if (plan.after in known) splice(root, plan.after, plan.name);
  else
    mergeSegments(root, {
      modules: { [plan.lane]: [plan.name], [plan.name]: [RENDER_NODE] },
    });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  wsWriteText(join(dir, plan.rel), stripNode(plan.lane));
  wsWriteText(graphPath, doc.toString());
  return [plan.rel, GRAPH_FILE];
}

/** A new picture lane WITH its strip; a strip that cannot be wired is said in `noStrip`, never refused. */
export function createPictureLane(
  dir: string,
  id: string,
): { written: string[]; noStrip: string } {
  const written = createPictureLaneFile(dir, id);
  try {
    return {
      written: [
        ...written,
        ...(addPictureMixer(dir, id, loadGraph(dir)) ?? []),
      ],
      noStrip: "",
    };
  } catch (e) {
    return { written, noStrip: (e as Error).message };
  }
}

/** Give every picture lane lacking one its strip — the back-fill on open; what it wrote, and what it could not. */
export function stripPictureLanes(dir: string): {
  written: string[];
  warnings: string[];
} {
  const written: string[] = [];
  const warnings: string[] = [];
  let g = loadGraph(dir);
  for (const lane of Object.keys(g.videoTracks))
    try {
      const done = addPictureMixer(dir, lane, g);
      if (!done) continue;
      written.push(...done);
      // Re-read only after a write: the next plan must see this strip's chain.
      g = loadGraph(dir);
    } catch (e) {
      warnings.push(`${lane}: ${(e as Error).message}`);
    }
  return { written, warnings };
}

/** Plan and apply in one, which is what a verb wants; null when the lane already had its strip. */
export function addPictureMixer(
  dir: string,
  lane: string,
  g: GraphDoc,
): string[] | null {
  const plan = planPictureMixer(dir, lane, g);
  return plan ? applyPictureMixer(dir, plan) : null;
}
