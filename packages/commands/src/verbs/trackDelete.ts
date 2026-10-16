// trackDelete.ts — `track delete <track>`: the lane AND the chain it starts — input, instrument,
// effects, strip — which is what deleting a track means in any DAW; a lane gone with its instrument
// left wired would sound under nothing. Its clips and sequences stay on disk, as `event remove`
// leaves them, and the journal undoes the lot. The catalogue marks it `confirm:`, so the menu asks.

import { dropNodeFromAssemblies } from "@studio/song/assemblyEdit";
import { isChainProject, readChainProject } from "@studio/song/chainProject";
import { loadGraph } from "@studio/song/graph";
import { loadProjectRoot } from "@studio/song/loader";
import { surfacesNaming } from "@studio/song/surfaces";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { deleteChainNode } from "@studio/song-edit/projectEdit";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";
import { laneMixer } from "./track.ts";

export const TRACK_DELETE_VERBS: Record<string, SidHandler> = {
  "track.delete": trackDeleteCommand,
};

/** The nodes a lane takes with it, the lane LAST: each delete rejoins around its node, and the lane is what the chain hangs on. */
function laneOwnNodes(dir: string, lane: string): string[] {
  if (isChainProject(dir)) {
    const cp = readChainProject(dir);
    const chain = cp.nodes[lane]?.chain;
    if (!chain) return [lane];
    const others = Object.values(cp.nodes)
      .filter((n) => n.chain === chain && n.name !== lane)
      .map((n) => n.name);
    return [...others, lane];
  }
  // A graph.yaml project names no chain a lane owns: its strip goes with it, every other node is shared.
  const mixer = laneMixer(loadGraph(dir), lane);
  return mixer ? [mixer, lane] : [lane];
}

async function trackDeleteCommand(a: string, h: CommandHost): Promise<void> {
  const arg = splitWords(a)[0];
  if (!arg) {
    h.refuse(["usage: track delete <track>"]);
    return;
  }
  const p = h.project();
  const t = p.tracks.find((x) => x.id === arg || x.name === arg);
  if (!t) {
    h.refuse([`no track "${arg}"`]);
    return;
  }
  const dir = h.songPath;
  // A surface mapping names the lane and nothing rewrites one, so deleting would leave it pointing nowhere.
  const mapped = surfacesNaming(dir, t.id);
  if (mapped.length) {
    h.refuse([
      `"${t.id}" is named by ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} — unmap it there first`,
    ]);
    return;
  }
  try {
    const nodes = laneOwnNodes(dir, t.id);
    for (const node of nodes) {
      deleteChainNode(dir, node);
      dropNodeFromAssemblies(dir, node);
    }
    // project.yaml names lanes in three lists; a deleted one would be named there for ever.
    const root = loadProjectRoot(dir);
    const projectFile = entityFileFor(dir, "", "project");
    for (const key of ["trackOrder", "soloed", "highlighted"] as const) {
      const list = (root as Record<string, unknown>)[key];
      if (!projectFile || !Array.isArray(list) || !list.includes(t.id))
        continue;
      const next = list.filter((x) => x !== t.id);
      if (next.length) setFileValue(projectFile.path, [key], next);
      else deleteFileValue(projectFile.path, [key]);
    }
    h.log([
      `deleted ${t.id} and the ${nodes.length - 1} node(s) of its chain — its clips stay on disk`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`track delete: ${(e as Error).message}`]);
  }
}
