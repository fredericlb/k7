// track.ts — the `track duplicate` verbs, and `track rename`. A duplicate copies the lane's
// signal chain, because it must not share its effect instances with the lane it came from; the
// empty form leaves the events behind. A rename moves the FILE, whose name is the whole lane name
// — position and instrument prefix included — and every reference to it follows.
// See packages/song/docs/nodes.md; a chain project is copied by trackChain.ts (docs/chainFiles.md).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { renameNodeInAssemblies } from "@studio/song/assemblyEdit";
import { chainTaken } from "@studio/song/chainCreate";
import { laneFileFor, laneFolder } from "@studio/song/chainItemEdit";
import { isChainProject, readChainProject } from "@studio/song/chainProject";
import { type GraphDoc, loadGraph } from "@studio/song/graph";
import {
  createTrackFile,
  loadModules,
  loadProjectRoot,
} from "@studio/song/loader";
import { SHARED_STRIP } from "@studio/song/scaffoldLive";
import { surfacesNaming } from "@studio/song/surfaces";
import { mixerNameFor } from "@studio/song/trackMixerFile";
import { setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { renameChainNode } from "@studio/song-edit/projectEdit";
import {
  addTrackPlacements,
  editTrackStruct,
} from "@studio/song-edit/trackMix";
import { instanceName } from "@studio/song-schema/instanceName";
import {
  isBuiltinOutput,
  portRef,
  splitPort,
} from "@studio/song-schema/moduleTypes";
import { mergeSegments, parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { Placement } from "@studio/song-schema/yaml/placementSchema";
import {
  placementValues,
  setTrackField,
} from "@studio/song-schema/yaml/trackFile";
import { parseDocument } from "yaml";
import type { CommandHost, SidHandler } from "../commands.ts";
import { duplicateLaneChain } from "./trackChain.ts";

export const TRACK_VERBS: Record<string, SidHandler> = {
  "track.duplicate": (a, h) => duplicateTrack(a, h, true),
  "track.duplicate.empty": (a, h) => duplicateTrack(a, h, false),
  "track.rename": (a, h) => renameTrack(a, h),
};

/** Copy a node's file and its own preset; a node's assets live in the shared `nodes/assets/`. */
function copyNode(dir: string, from: string, to: string): void {
  const src = join(dir, "nodes", `${from}.yaml`);
  if (!existsSync(src)) throw new Error(`no node '${from}' to copy`);
  copyFileSync(src, join(dir, "nodes", `${to}.yaml`));
  const preset = join(dir, "nodes", `${from}.vstpreset`);
  if (existsSync(preset))
    copyFileSync(preset, join(dir, "nodes", `${to}.vstpreset`));
}

/** A module used directly as a node has no file to copy; give the copy a node that extends it. */
function materialiseNode(dir: string, from: string, to: string): void {
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", `${to}.yaml`),
    `extends: ${JSON.stringify(from)}\n`,
    "utf8",
  );
}

/** The strip file's first line names the lane it belongs to; a copy has to be re-labelled. */
function relabelStrip(abs: string, lane: string): void {
  const text = readFileSync(abs, "utf8");
  const next = text.replace(
    /^# .*?'s channel strip/,
    `# ${lane}'s channel strip`,
  );
  if (next !== text) writeFileSync(abs, next, "utf8");
}

/** Copy the lane's exclusive chain nodes and wire the new lane into the graph. */
function duplicateChain(
  dir: string,
  lane: string,
  newLane: string,
  g: GraphDoc,
  taken: (name: string) => boolean,
  claim: (name: string) => string,
): string[] {
  const graphAbs = join(dir, GRAPH_FILE);
  if (!existsSync(graphAbs)) return [];
  const text = readFileSync(graphAbs, "utf8");
  const parsed = parseGraph(text);
  if (!parsed.value)
    throw new Error(`graph.yaml: ${parsed.issues[0]?.message ?? "unreadable"}`);

  const map = parsed.value.modules ?? {};
  const sourceKeys = Object.keys(map).filter(
    (key) => splitPort(key).node === lane,
  );

  const incoming = new Map<string, number>();
  for (const dests of Object.values(map))
    for (const d of dests) {
      const node = splitPort(d).node;
      incoming.set(node, (incoming.get(node) ?? 0) + 1);
    }

  const lanes = new Set<string>([
    ...Object.keys(g.tracks),
    ...Object.keys(g.videoTracks),
    ...g.disabledTracks,
  ]);
  const boundary = (node: string): boolean =>
    isBuiltinOutput(node) || lanes.has(node) || node === lane;

  const isStrip = (node: string): boolean => {
    const m = g.modules[node];
    return (
      !!m && (m.plugin?.name === MIXER_PLUGIN || m.extends === SHARED_STRIP)
    );
  };

  const clones = new Map<string, string>();
  const order: string[] = [];
  const cloneName = (node: string): string => {
    if (isStrip(node)) return claim(mixerNameFor(newLane, taken));
    const m = g.modules[node];
    // A step naming a SHARED module directly is the qualified ref itself (`@workspace/audio/amp`);
    // the instance is named after its last segment, same as inheriting one through `extends`.
    const leaf = m?.extends
      ? (String(m.extends).split("/").pop() ?? node)
      : node.startsWith("@")
        ? (node.split("/").pop() ?? node)
        : node;
    return claim(instanceName(leaf, newLane, taken));
  };
  const shouldClone = (node: string): boolean =>
    !boundary(node) && (incoming.get(node) ?? 0) === 1;

  const mapDest = (d: string): string => {
    const { node, port } = splitPort(d);
    if (!shouldClone(node)) return d;
    let to = clones.get(node);
    if (!to) {
      to = cloneName(node);
      clones.set(node, to);
      order.push(node);
    }
    return portRef(to, port);
  };

  const additions: Record<string, string[]> = {};
  for (const key of sourceKeys) {
    const port = splitPort(key).port;
    additions[portRef(newLane, port)] = (map[key] ?? []).map(mapDest);
  }
  for (let i = 0; i < order.length; i++) {
    const from = order[i];
    additions[clones.get(from) as string] = (map[from] ?? []).map(mapDest);
  }

  const addBypassed: string[] = [];
  const addBusOnly: string[] = [];
  for (const from of order) {
    const to = clones.get(from) as string;
    if (parsed.value.bypassed?.includes(from)) addBypassed.push(to);
    if (parsed.value.bus_only?.includes(from)) addBusOnly.push(to);
  }

  const written: string[] = [];
  for (const from of order) {
    const to = clones.get(from) as string;
    if (existsSync(join(dir, "nodes", `${from}.yaml`))) copyNode(dir, from, to);
    else materialiseNode(dir, from, to);
    if (isStrip(from)) relabelStrip(join(dir, "nodes", `${to}.yaml`), newLane);
    written.push(`nodes/${to}.yaml`);
  }

  if (
    Object.keys(additions).length ||
    addBypassed.length ||
    addBusOnly.length
  ) {
    const next = mergeSegments(text, {
      modules: additions,
      ...(addBypassed.length ? { bypassed: addBypassed } : {}),
      ...(addBusOnly.length ? { bus_only: addBusOnly } : {}),
    });
    if (next !== text) writeFileSync(graphAbs, next, "utf8");
    written.push(GRAPH_FILE);
  }
  return written;
}

async function duplicateTrack(
  arg: string,
  h: CommandHost,
  copyEvents: boolean,
): Promise<void> {
  const idArg = arg.trim().split(/\s+/).filter(Boolean)[0];
  if (!idArg) {
    h.refuse([`usage: track duplicate${copyEvents ? "" : " empty"} <track>`]);
    return;
  }
  const dir = h.songPath;
  const lane = splitPort(idArg).node;
  const chained = isChainProject(dir);
  const srcRel = join(laneFolder(dir), `${lane}.yaml`);
  const srcAbs = join(dir, srcRel);
  if (!existsSync(srcAbs)) {
    h.refuse([`no track "${idArg}" — ${srcRel} does not exist`]);
    return;
  }
  try {
    const srcText = readFileSync(srcAbs, "utf8");
    const srcValue = parseDocument(srcText, {
      version: "1.2",
    }).toJS() as Record<string, unknown>;
    if (Array.isArray(srcValue.tracks)) {
      h.refuse([`"${lane}" is a group — a group has no events to duplicate`]);
      return;
    }
    if (typeof srcValue.strudel === "string") {
      h.refuse([`"${lane}" is a strudel lane — duplicate the pattern instead`]);
      return;
    }

    const g = chained ? null : loadGraph(dir);
    const graphAbs = join(dir, GRAPH_FILE);
    const graphText =
      !chained && existsSync(graphAbs) ? readFileSync(graphAbs, "utf8") : "";
    const parsed = graphText ? parseGraph(graphText) : null;
    if (parsed && (!parsed.value || parsed.issues.length))
      throw new Error(parsed.issues[0]?.message ?? "graph.yaml unreadable");
    // In a chain project the graph's names are the chain files' nodes, and a chain's name is taken too.
    const modules = chained
      ? readChainProject(dir).nodes
      : (parsed?.value?.modules ?? {});

    // One name space: the graph keys, the module folders and the node files (docs/nodes.md).
    const reserved = new Set<string>();
    const loadedModules = loadModules(dir);
    const taken = (name: string): boolean =>
      reserved.has(name) ||
      name in modules ||
      name in loadedModules ||
      existsSync(join(dir, laneFolder(dir), `${name}.yaml`)) ||
      (chained && chainTaken(dir, name));
    const claim = (name: string): string => {
      reserved.add(name);
      return name;
    };

    const base = `${lane}-copy`;
    let newLane = base;
    let n = 2;
    while (taken(newLane)) newLane = `${base}-${n++}`;
    claim(newLane);

    const made = createTrackFile(dir, newLane);
    const srcColor =
      typeof srcValue.color === "string" ? srcValue.color : undefined;
    if (srcColor)
      editTrackStruct(
        dir,
        newLane,
        (text) => setTrackField(text, "color", srcColor),
        `copy a track's colour`,
      );
    if (copyEvents) {
      const placements = placementValues(srcText) as Placement[];
      if (placements.length) addTrackPlacements(dir, newLane, placements);
    }

    const chainFiles = g
      ? duplicateChain(dir, lane, newLane, g, taken, claim)
      : duplicateLaneChain(dir, lane, newLane, taken, claim);
    await h.reload();
    const files = [...new Set([...made, ...chainFiles])];
    h.log([`+ track ${newLane} (${files.join(", ")})`]);
  } catch (e) {
    h.refuse([`track duplicate: ${(e as Error).message}`]);
  }
}

/** A name `mixerNameFor` made for `lane` — `mix-<lane>` or `mix-<lane>-<n>` — so it may follow the lane's. */
const isLaneMixerName = (name: string, lane: string): boolean => {
  const base = `mix-${lane}`;
  return (
    name === base ||
    (name.startsWith(`${base}-`) && /^\d+$/.test(name.slice(base.length + 1)))
  );
};

/** The lane's strip, when it bears the name `track new` gave it: a name somebody CHOSE is left alone. */
export function laneMixer(g: GraphDoc, lane: string): string | null {
  const chain = Object.values(g.chains).find((c) => c.from === lane);
  for (const step of chain?.use ?? []) {
    const m = g.modules[step.module];
    const strip =
      m?.plugin?.name === MIXER_PLUGIN || m?.extends === SHARED_STRIP;
    if (strip && isLaneMixerName(step.module, lane)) return step.module;
  }
  return null;
}

/** `track rename <track> <new name>` — the file, the graph, the boxes, the order, the solo and the strip follow. */
async function renameTrack(arg: string, h: CommandHost): Promise<void> {
  const [idArg, to] = arg.trim().split(/\s+/).filter(Boolean);
  if (!idArg || !to) {
    h.refuse([
      "usage: track rename <track> <new name> (the whole name, prefix included — e.g. track rename ge.lead vo.lead)",
    ]);
    return;
  }
  const dir = h.songPath;
  const lane = splitPort(idArg).node;
  if (!laneFileFor(dir, lane)) {
    h.refuse([
      `no track "${idArg}" — ${laneFolder(dir)}/${lane}.yaml does not exist`,
    ]);
    return;
  }
  if (to === lane) {
    h.refuse([`"${lane}" is already called that`]);
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(to)) {
    h.refuse([
      `invalid track name '${to}' — letters, digits, '.', '_' and '-' only`,
    ]);
    return;
  }
  // A surface mapping names a node and nothing writes one back, so a rename would leave it pointing nowhere.
  const mapped = surfacesNaming(dir, lane);
  if (mapped.length) {
    h.refuse([
      `"${lane}" is named by ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} — a mapping is not rewritten, so the track keeps its name`,
    ]);
    return;
  }
  try {
    const chained = isChainProject(dir);
    const graphAbs = join(dir, GRAPH_FILE);
    const onGraph =
      !chained && existsSync(graphAbs)
        ? (parseGraph(readFileSync(graphAbs, "utf8")).value?.modules ?? {})
        : {};
    const nodes = chained ? readChainProject(dir).nodes : {};
    const taken = (name: string): boolean =>
      name in onGraph ||
      name in nodes ||
      existsSync(join(dir, laneFolder(dir), `${name}.yaml`));
    if (taken(to)) {
      h.refuse([`"${to}" is already a node of this project`]);
      return;
    }
    // Read before the lane moves: the strip is found by the chain the lane STARTS.
    const mixer = chained ? null : laneMixer(loadGraph(dir), lane);

    const { moved, rewired } = renameChainNode(dir, lane, to);
    const boxes = renameNodeInAssemblies(dir, lane, to);
    const notes = [...moved];
    if (rewired.length) notes.push(`rewired ${rewired.join(", ")}`);
    if (boxes.length) notes.push(`followed in ${boxes.join(", ")}`);

    // project.yaml names lanes in two lists: the order they are drawn in, and the soloed ones.
    const root = loadProjectRoot(dir);
    const projectFile = entityFileFor(dir, "", "project");
    for (const key of ["trackOrder", "soloed"] as const) {
      const list = root[key];
      if (!projectFile || !Array.isArray(list) || !list.includes(lane))
        continue;
      setFileValue(
        projectFile.path,
        [key],
        list.map((x) => (x === lane ? to : x)),
      );
      notes.push(`${key} in ${projectFile.rel.replace(/^\//, "")}`);
    }

    // The strip `track new` named after the lane follows it, its first line re-labelled too.
    if (mixer) {
      const next = mixerNameFor(to, (n) => n !== mixer && taken(n));
      if (next !== mixer) {
        renameChainNode(dir, mixer, next);
        renameNodeInAssemblies(dir, mixer, next);
        const strip = join(dir, "nodes", `${next}.yaml`);
        if (existsSync(strip)) relabelStrip(strip, to);
        notes.push(`${mixer} → ${next}`);
      }
    }
    await h.reload();
    h.log([`${lane} → ${to} (${notes.join(", ")})`]);
  } catch (e) {
    h.refuse([`track rename: ${(e as Error).message}`]);
  }
}
