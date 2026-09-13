// track.ts — the `track duplicate` verbs: one lane becomes two, each with its own
// copy of the signal chain. The empty form leaves the events behind; the chain is
// copied either way, because a duplicated lane must not share its effect instances
// with the lane it came from. See packages/song/docs/nodes.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { loadGraph, type GraphDoc } from "@studio/song/graph";
import { createTrackFile, loadModules } from "@studio/song/loader";
import { SHARED_STRIP } from "@studio/song/scaffoldLive";
import { mixerNameFor } from "@studio/song/trackMixerFile";
import { editTrackStruct, addTrackPlacements } from "@studio/song-edit/trackMix";
import { instanceName } from "@studio/song-schema/instanceName";
import {
  isBuiltinOutput,
  moduleRefOf,
  portRef,
  splitPort,
} from "@studio/song-schema/moduleTypes";
import {
  mergeSegments,
  parseGraph,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { Placement } from "@studio/song-schema/yaml/placementSchema";
import {
  placementValues,
  setTrackField,
} from "@studio/song-schema/yaml/trackFile";
import { parseDocument } from "yaml";
import type { CommandHost, SidHandler } from "../commands.ts";

export const TRACK_VERBS: Record<string, SidHandler> = {
  "track.duplicate": (a, h) => duplicateTrack(a, h, true),
  "track.duplicate.empty": (a, h) => duplicateTrack(a, h, false),
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
function materialiseNode(
  dir: string,
  from: string,
  to: string,
  m: GraphDoc["modules"][string] | undefined,
): void {
  const ref = from.startsWith("@")
    ? from
    : m?.category
      ? `@project/${moduleRefOf(m.category, from)}`
      : from;
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", `${to}.yaml`),
    `extends: ${JSON.stringify(ref)}\n`,
    "utf8",
  );
}

/** The strip file's first line names the lane it belongs to; a copy has to be re-labelled. */
function relabelStrip(abs: string, lane: string): void {
  const text = readFileSync(abs, "utf8");
  const next = text.replace(/^# .*?'s channel strip/, `# ${lane}'s channel strip`);
  if (next !== text) writeFileSync(abs, next, "utf8");
}

/** Copy the lane's exclusive chain nodes and wire the new lane into the graph. */
function duplicateChain(
  dir: string,
  lane: string,
  newLane: string,
  g: GraphDoc,
  modules: Record<string, string[]>,
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
    return !!m && (m.plugin?.name === MIXER_PLUGIN || m.extends === SHARED_STRIP);
  };

  const clones = new Map<string, string>();
  const order: string[] = [];
  const cloneName = (node: string): string => {
    if (isStrip(node)) return claim(mixerNameFor(newLane, taken));
    const m = g.modules[node];
    const leaf = m?.extends
      ? String(m.extends).split("/").pop() ?? node
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
    else materialiseNode(dir, from, to, g.modules[from]);
    if (isStrip(from)) relabelStrip(join(dir, "nodes", `${to}.yaml`), newLane);
    written.push(`nodes/${to}.yaml`);
  }

  if (Object.keys(additions).length || addBypassed.length || addBusOnly.length) {
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
  const srcRel = join("nodes", `${lane}.yaml`);
  const srcAbs = join(dir, srcRel);
  if (!existsSync(srcAbs)) {
    h.refuse([`no track "${idArg}" — ${srcRel} does not exist`]);
    return;
  }
  try {
    const srcText = readFileSync(srcAbs, "utf8");
    const srcValue = parseDocument(srcText, { version: "1.2" }).toJS() as Record<
      string,
      unknown
    >;
    if (Array.isArray(srcValue.tracks)) {
      h.refuse([`"${lane}" is a group — a group has no events to duplicate`]);
      return;
    }
    if (typeof srcValue.strudel === "string") {
      h.refuse([`"${lane}" is a strudel lane — duplicate the pattern instead`]);
      return;
    }

    const g = loadGraph(dir);
    const graphAbs = join(dir, GRAPH_FILE);
    const graphText = existsSync(graphAbs)
      ? readFileSync(graphAbs, "utf8")
      : "";
    const parsed = graphText ? parseGraph(graphText) : null;
    if (parsed && (!parsed.value || parsed.issues.length))
      throw new Error(parsed.issues[0]?.message ?? "graph.yaml unreadable");
    const modules = parsed?.value?.modules ?? {};

    // One name space: the graph keys, the module folders and the node files (docs/nodes.md).
    const reserved = new Set<string>();
    const loadedModules = loadModules(dir);
    const taken = (name: string): boolean =>
      reserved.has(name) ||
      name in modules ||
      name in loadedModules ||
      existsSync(join(dir, "nodes", `${name}.yaml`));
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

    const chainFiles = duplicateChain(
      dir,
      lane,
      newLane,
      g,
      modules,
      taken,
      claim,
    );
    await h.reload();
    h.log([`+ track ${newLane} (${[...made, ...chainFiles].join(", ")})`]);
  } catch (e) {
    h.refuse([`track duplicate: ${(e as Error).message}`]);
  }
}
