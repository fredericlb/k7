// track.ts — the `track duplicate` verbs, and `track rename`. A duplicate copies the lane's
// signal chain, because it must not share its effect instances with the lane it came from; the
// empty form leaves the events behind. A rename moves the FILE, whose name is the whole lane name
// — position and instrument prefix included — and every reference to it follows.
// See packages/song/docs/nodes.md; a chain project is copied by trackChain.ts (docs/chainFiles.md).

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { renameNodeInAssemblies } from "@studio/song/assemblyEdit";
import { chainTaken } from "@studio/song/chainCreate";
import { laneFileFor, laneFolder } from "@studio/song/chainItemEdit";
import { isChainProject, readChainProject } from "@studio/song/chainProject";
import { type GraphDoc, loadGraph } from "@studio/song/graph";
import {
  isLaneStrip,
  mixerNameFor,
  ownLaneStrip,
} from "@studio/song/laneStrip";
import {
  createTrackFile,
  loadModules,
  loadProjectRoot,
  setLaneOrder,
} from "@studio/song/loader";
import { surfacesNaming } from "@studio/song/surfaces";
import { setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import {
  wsData,
  wsEdit,
  wsText,
  wsWriteData,
} from "@studio/song/yaml/workspaceDoc";
import { wsCopy, wsExists } from "@studio/song/yaml/workspaceFile";
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
import { arrangeByCategory, autoColors } from "@studio/song-schema/trackColor";
import {
  TRACK_CATEGORIES,
  type TrackCategory,
  trackCategory,
} from "@studio/song-schema/trackKind";
import { mergeSegments, parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { Placement } from "@studio/song-schema/yaml/placementSchema";
import {
  placementValues,
  setTrackField,
} from "@studio/song-schema/yaml/trackFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";
import { duplicateLaneChain } from "./trackChain.ts";

export const TRACK_VERBS: Record<string, SidHandler> = {
  "track.arrange": (_a, h) => arrangeTracks(h),
  "track.duplicate": (a, h) => duplicateTrack(a, h, true),
  "track.duplicate.empty": (a, h) => duplicateTrack(a, h, false),
  "track.rename": (a, h) => renameTrack(a, h),
};

/** Copy a node's file and its own preset; a node's assets live in the shared `nodes/assets/`. */
function copyNode(dir: string, from: string, to: string): void {
  const src = join(dir, "nodes", `${from}.k7x`);
  if (!wsExists(src)) throw new Error(`no node '${from}' to copy`);
  wsCopy(src, join(dir, "nodes", `${to}.k7x`));
  const preset = join(dir, "nodes", `${from}.vstpreset`);
  if (wsExists(preset))
    copyFileSync(preset, join(dir, "nodes", `${to}.vstpreset`));
}

/** A module used directly as a node has no file to copy; give the copy a node that extends it. */
function materialiseNode(dir: string, from: string, to: string): void {
  mkdirSync(join(dir, "nodes"), { recursive: true });
  wsWriteData(join(dir, "nodes", `${to}.k7x`), { extends: from });
}

/** The strip file's first comment line names the lane it belongs to; a copy has to be re-labelled. */
function relabelStrip(abs: string, lane: string): void {
  wsEdit(abs, (doc) => {
    const [first, ...rest] = doc.header;
    if (first === undefined) return;
    const next = first.replace(
      /^.*?'s channel strip/,
      `${lane}'s channel strip`,
    );
    if (next !== first) doc.setHeader([next, ...rest]);
  });
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
  if (!wsExists(graphAbs)) return [];
  const parsed = parseGraph(wsText(graphAbs));
  if (!parsed.value)
    throw new Error(`graph.k7x: ${parsed.issues[0]?.message ?? "unreadable"}`);

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

  const isStrip = (node: string): boolean => isLaneStrip(g, node);

  const clones = new Map<string, string>();
  const order: string[] = [];
  const cloneName = (node: string): string => {
    if (isStrip(node)) return claim(mixerNameFor(newLane, taken));
    const m = g.modules[node];
    // A step naming a SHARED module by its ref (`@workspace/audio/amp`) is named after its last segment.
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
    if (wsExists(join(dir, "nodes", `${from}.k7x`))) copyNode(dir, from, to);
    else materialiseNode(dir, from, to);
    if (isStrip(from)) relabelStrip(join(dir, "nodes", `${to}.k7x`), newLane);
    written.push(`nodes/${to}.k7x`);
  }

  if (
    Object.keys(additions).length ||
    addBypassed.length ||
    addBusOnly.length
  ) {
    const segments = {
      modules: additions,
      ...(addBypassed.length ? { bypassed: addBypassed } : {}),
      ...(addBusOnly.length ? { bus_only: addBusOnly } : {}),
    };
    wsEdit(graphAbs, (doc) => mergeSegments(doc.at([]), segments));
    written.push(GRAPH_FILE);
  }
  return written;
}

async function duplicateTrack(
  arg: string,
  h: CommandHost,
  copyEvents: boolean,
): Promise<void> {
  const idArg = splitWords(arg)[0];
  if (!idArg) {
    h.refuse([`usage: track duplicate${copyEvents ? "" : " empty"} <track>`]);
    return;
  }
  const dir = h.songPath;
  const lane = splitPort(idArg).node;
  const chained = isChainProject(dir);
  const srcRel = `${laneFolder(dir)}/${lane}.k7x`;
  const srcAbs = join(dir, srcRel);
  if (!wsExists(srcAbs)) {
    h.refuse([`no track "${idArg}" — ${srcRel} does not exist`]);
    return;
  }
  try {
    const srcText = wsText(srcAbs);
    const srcValue = wsData(srcAbs);
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
    const graphText = !chained && wsExists(graphAbs) ? wsText(graphAbs) : "";
    const parsed = graphText ? parseGraph(graphText) : null;
    if (parsed && (!parsed.value || parsed.issues.length))
      throw new Error(parsed.issues[0]?.message ?? "graph.k7x unreadable");
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
      wsExists(join(dir, laneFolder(dir), `${name}.k7x`)) ||
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
        (doc) => setTrackField(doc, "color", srcColor),
        `copy a track's colour`,
      );
    if (copyEvents) {
      const source = new K7Document(srcText).at([]);
      const placements = placementValues(source) as Placement[];
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

/** The strip `track new` named after a lane follows its rename, its first line re-labelled too — sound or picture. */
export function followStripName(
  dir: string,
  mixer: string,
  to: string,
  taken: (name: string) => boolean,
): string | null {
  const next = mixerNameFor(to, (n) => n !== mixer && taken(n));
  if (next === mixer) return null;
  renameChainNode(dir, mixer, next);
  renameNodeInAssemblies(dir, mixer, next);
  const strip = join(dir, "nodes", `${next}.k7x`);
  if (wsExists(strip)) relabelStrip(strip, to);
  return `${mixer} → ${next}`;
}

/** `track rename <track> <new name>` — the file, the graph, the boxes, the order, the solo and the strip follow. */
async function renameTrack(arg: string, h: CommandHost): Promise<void> {
  const [idArg, to] = splitWords(arg);
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
      `no track "${idArg}" — ${laneFolder(dir)}/${lane}.k7x does not exist`,
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
      !chained && wsExists(graphAbs)
        ? (parseGraph(wsText(graphAbs)).value?.modules ?? {})
        : {};
    const nodes = chained ? readChainProject(dir).nodes : {};
    const taken = (name: string): boolean =>
      name in onGraph ||
      name in nodes ||
      wsExists(join(dir, laneFolder(dir), `${name}.k7x`));
    if (taken(to)) {
      h.refuse([`"${to}" is already a node of this project`]);
      return;
    }
    // Read before the lane moves: the strip is found by the chain the lane STARTS.
    const mixer = chained ? null : ownLaneStrip(dir, loadGraph(dir), lane);

    const { moved, rewired } = renameChainNode(dir, lane, to);
    const boxes = renameNodeInAssemblies(dir, lane, to);
    const notes = [...moved];
    if (rewired.length) notes.push(`rewired ${rewired.join(", ")}`);
    if (boxes.length) notes.push(`followed in ${boxes.join(", ")}`);

    // project.k7x names lanes in two lists: the order they are drawn in, and the soloed ones.
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

    const followed = mixer && followStripName(dir, mixer, to, taken);
    if (followed) notes.push(followed);
    await h.reload();
    h.log([`${lane} → ${to} (${notes.join(", ")})`]);
  } catch (e) {
    h.refuse([`track rename: ${(e as Error).message}`]);
  }
}

/** Each lane's category: its name first, then what the chains leaving it are built from — song-schema docs/trackColor.md. */
function laneCategories(g: GraphDoc): Record<string, TrackCategory> {
  const hints: Record<string, string[]> = {};
  for (const c of Object.values(g.chains)) {
    if (!c.from) continue;
    const lane = splitPort(c.from).node;
    for (const step of c.use) {
      const m = g.modules[step.module];
      if (m)
        hints[lane] = [...(hints[lane] ?? []), m.extends ?? "", m.type ?? ""];
    }
  }
  const out: Record<string, TrackCategory> = {};
  for (const lane of Object.keys(g.tracks))
    out[lane] = trackCategory(lane, hints[lane] ?? []);
  return out;
}

/** `track arrange` — every lane coloured by its category and the whole order stated, vox first; one command, so one undo. */
async function arrangeTracks(h: CommandHost): Promise<void> {
  const dir = h.songPath;
  const g = loadGraph(dir);
  const cats = laneCategories(g);
  // The lanes as they are drawn now, so the order within a category is the one the person already had — those with a file to colour.
  const lanes = [
    ...new Set(h.project().tracks.map((t) => splitPort(t.id).node)),
  ].filter((lane) => laneFileFor(dir, lane) !== null);
  if (!lanes.length) return h.refuse(["track arrange: this song has no lanes"]);
  const categoryOf = (lane: string) => cats[lane] ?? trackCategory(lane);
  const ordered = arrangeByCategory(lanes, categoryOf);
  const colors = autoColors(
    ordered.map((lane) => ({ id: lane, category: categoryOf(lane) })),
  );
  try {
    for (const lane of ordered) {
      const color = colors.get(lane);
      if (color)
        editTrackStruct(
          dir,
          lane,
          (doc) => setTrackField(doc, "color", color),
          "colour a track by its category",
        );
    }
    setLaneOrder(dir, "trackOrder", ordered);
  } catch (e) {
    return h.refuse([`track arrange: ${(e as Error).message}`]);
  }
  // Said per category, in layout order, so the answer reads like the screen it produced.
  const said = TRACK_CATEGORIES.map((c) => {
    const of = ordered.filter((lane) => categoryOf(lane) === c);
    return of.length ? `${c}: ${of.join(", ")}` : "";
  }).filter(Boolean);
  h.log([`arranged ${ordered.length} tracks — ${said.join(" · ")}`]);
  await h.reload();
}
