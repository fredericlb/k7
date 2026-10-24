// graphEdit.ts — the graph verbs: each a `graph.k7x` writer from graphFile.ts, run on
// the file, or — in a chain project — on its chain files read as segments and written back. The
// writers are the same in both, which is why a chain project needs no verbs of its own.
// What would be got wrong: in a chain project a non-lane node is its id, and renaming one is a no-op.
// See packages/song/docs/chainFiles.md and docs/projectEdit.md.

import { renameSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import type { K7Scope } from "@studio/k7x/document";
import {
  chainGraphText,
  chainNodeName,
  deleteChainItem,
  editChainGraph,
  renameChainLane,
} from "@studio/song/chainGraphEdit";
import { isChainProject, readChainProject } from "@studio/song/chainProject";
import { chainsUsing } from "@studio/song/moduleFork";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsEdit, wsText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import {
  addNode,
  clearNodePositions,
  connectNodes,
  disconnectNodes,
  insertBetween,
  parseGraph,
  removeNode,
  renameNode,
  setModuleEnabled,
  setNodePosition,
  setNodePositions,
  unlinkNode,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE, GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";

/** The graph file a folder holds — a project's, or a library CHAIN's, which is the same file; docs/projectEdit.md. */
function graphFileOf(dir: string): { path: string } {
  const file = entityFileFor(dir, "", GRAPH_BASE);
  if (!file) throw new Error(`${dir}: no ${GRAPH_FILE}`);
  return { path: file.path };
}

/** Run a `graph.k7x` writer — on the file, or through a chain project's files (docs/chainFiles.md); what was written. */
function editGraph(dir: string, edit: (graph: K7Scope) => void): string {
  if (isChainProject(dir)) {
    editChainGraph(dir, edit);
    return join(dir, "chains");
  }
  const { path } = graphFileOf(dir);
  // graphFile's writers expand `runs` and put it back themselves, so they see the document as written.
  wsEdit(path, (doc) => edit(doc.at([])), { raw: true });
  return path;
}

/** The segments text a graph writer reads — the file, or a chain project's chains as segments. */
function graphText(dir: string): string {
  return isChainProject(dir)
    ? chainGraphText(dir)
    : wsText(graphFileOf(dir).path);
}

// A node name as a caller gave it: in a chain project, a one-node chain's name stands for that node.
const nodeArg = (dir: string, name: string): string =>
  isChainProject(dir) ? chainNodeName(dir, name) : name;

/** Bypass (or re-enable) a module — off-then-on returns the file to what it was, and no chain need be named. */
export function setModuleBypass(
  dir: string,
  module: string,
  bypassed: boolean,
): string {
  const node = nodeArg(dir, module);
  return editGraph(dir, (doc) => setModuleEnabled(doc, node, !bypassed));
}

/** Mute (or unmute) a LANE through its bypass, giving the graph an entry for a lane it does not name yet — a picture lane often has none. */
export function setLaneBypass(
  dir: string,
  lane: string,
  bypassed: boolean,
): string {
  const node = nodeArg(dir, lane);
  return editGraph(dir, (doc) => {
    if (bypassed) addNode(doc, node);
    else {
      const listed = doc.getIn(["bypassed"]);
      // Unmuting a lane nothing bypasses is already done; the graph would refuse a name it does not hold.
      if (!Array.isArray(listed) || !listed.includes(node)) return;
    }
    setModuleEnabled(doc, node, !bypassed);
  });
}

/** Set (or clear) one `bypassed:` entry the graph need not hold as a node — a picture lane's `#audio` half (song docs/videoSound.md). */
export function setBypassEntry(
  dir: string,
  name: string,
  bypassed: boolean,
): string {
  return editGraph(dir, (doc) => {
    const was = doc.getIn(["bypassed"]);
    const list = Array.isArray(was) ? was.map(String) : [];
    const next = bypassed
      ? [...new Set([...list, name])]
      : list.filter((x) => x !== name);
    if (next.length === list.length && next.every((x, i) => x === list[i]))
      return;
    // The list disappears when it empties, so muting and unmuting leaves the file as it was.
    if (next.length) doc.setIn(["bypassed"], next, { inline: true });
    else doc.deleteIn(["bypassed"]);
  });
}

/** Take a node out of the SIGNAL PATH, joining what fed it to what it fed, and leave it in the graph wired to nothing. */
export function unlinkChainNode(
  dir: string,
  name: string,
): { rewired: string[] } {
  const node = nodeArg(dir, name);
  const text = graphText(dir);
  const { value, issues } = parseGraph(text);
  if (!value)
    throw new Error(`${GRAPH_FILE}: ${issues[0]?.message ?? "unreadable"}`);
  // The last module in a run has no entry of its own, and is still in the chain and unlinkable.
  const isDest = Object.values(value.modules ?? {}).some((dests) =>
    dests.includes(node),
  );
  if (!(node in (value.modules ?? {})) && !isDest)
    throw new Error(`no '${node}' in the chains`);
  let rewired: string[] = [];
  editGraph(dir, (doc) => {
    rewired = unlinkNode(doc, node);
  });
  return { rewired };
}

/** The lane whose chain plays `node`, or null — the FIRST when several reach it, docs/projectEdit.md. */
export function laneOfNode(dir: string, node: string): string | null {
  try {
    return chainsUsing(graphText(dir), nodeArg(dir, node))[0] ?? null;
  } catch {
    return null; // no graph, or one that will not read — a node with no run to be named after
  }
}

/** Is `name` on the graph without a file of its own — a MODULE used directly as a node, docs/projectEdit.md. */
function moduleUsedAsNode(dir: string, name: string): boolean {
  // A chain project has no such shape: every node is an item (docs/chainFiles.md).
  if (isChainProject(dir)) return false;
  if (entityFileFor(join(dir, "nodes"), "nodes", name)) return false;
  try {
    const g = parseGraph(graphText(dir)).value;
    const modules = g?.modules ?? {};
    return (
      name in modules ||
      Object.values(modules).some((dests) => (dests ?? []).includes(name))
    );
  } catch {
    return false; // no graph, or one that will not read — nothing says this name is on it
  }
}

/** Rename a node: its file, its preset, and every trace of it in the chains — the order is load-bearing, docs/projectEdit.md. */
export function renameChainNode(
  dir: string,
  from: string,
  to: string,
): { moved: string[]; rewired: string[] } {
  if (isChainProject(dir)) return renameInChains(dir, from, to);
  const found = entityFileFor(join(dir, "nodes"), "nodes", from);
  if (!found) {
    // A module used directly has no instance to rename: the name on the graph IS the module's.
    if (moduleUsedAsNode(dir, from))
      throw new Error(
        `'${from}' is a module used directly on the graph, not a node of one — rename the module, ` +
          `or give it a node first (\`node new\`) and rename that`,
      );
    throw new Error(`no node '${from}' in this project`);
  }
  const ext = extname(found.path);
  const destAbs = join(dir, "nodes", `${to}${ext}`);
  if (wsExists(destAbs))
    throw new Error(`nodes/${to}${ext} already exists — refusing to overwrite`);
  const moved = [`${found.rel} → nodes/${to}${ext}`];
  renameSync(found.path, destAbs);
  const preset = join(dir, "nodes", `${from}.vstpreset`);
  if (wsExists(preset)) {
    renameSync(preset, join(dir, "nodes", `${to}.vstpreset`));
    moved.push(`nodes/${from}.vstpreset → nodes/${to}.vstpreset`);
  }
  let rewired: string[] = [];
  editGraph(dir, (doc) => {
    rewired = renameNode(doc, from, to);
  });
  return { moved, rewired };
}

/** A chain project renames LANES only: any other node is known by its id, so renaming it changes nothing (docs/chainFiles.md). */
function renameInChains(
  dir: string,
  from: string,
  to: string,
): { moved: string[]; rewired: string[] } {
  const n = readChainProject(dir).nodes[from];
  if (!n) throw new Error(`no node '${from}' in this project`);
  if (!n.track) return { moved: [], rewired: [] };
  if (!/^[A-Za-z0-9_.-]+$/.test(to))
    throw new Error(
      `invalid track name '${to}' — letters, digits, '.', '_' and '-' only`,
    );
  if (readChainProject(dir).nodes[to])
    throw new Error(`'${to}' is already a node of this project`);
  let rewired: string[] = [];
  const moved = renameChainLane(dir, from, to, (doc) => {
    rewired = renameNode(doc, from, to);
  });
  return { moved, rewired };
}

/** Delete a node: its file, its preset, and every trace of it in the chains — files first, docs/projectEdit.md. */
export function deleteChainNode(
  dir: string,
  name: string,
): { rewired: string[]; removed: string[] } {
  if (isChainProject(dir)) {
    const node = nodeArg(dir, name);
    let rewired: string[] = [];
    const removed = deleteChainItem(dir, node, (doc) => {
      rewired = removeNode(doc, node);
    });
    return { rewired, removed };
  }
  const node = name;
  const found = entityFileFor(join(dir, "nodes"), "nodes", node);
  if (!found) {
    // A module used directly: no file to delete, the MODULE stays, and only its place in the graph goes.
    if (moduleUsedAsNode(dir, node)) {
      let rewired: string[] = [];
      editGraph(dir, (doc) => {
        rewired = removeNode(doc, node);
      });
      return { rewired, removed: [] };
    }
    throw new Error(`no node '${node}' in this project`);
  }
  const removed = [found.rel];
  rmSync(found.path, { force: true });
  // Its own preset, when it has one — `nodes/<node>.vstpreset` (see loader's ancestry fold).
  const preset = join(dir, "nodes", `${node}.vstpreset`);
  if (wsExists(preset)) {
    rmSync(preset, { force: true });
    removed.push(`nodes/${node}.vstpreset`);
  }
  let rewired: string[] = [];
  editGraph(dir, (doc) => {
    rewired = removeNode(doc, node);
  });
  return { rewired, removed };
}

/** Put a module in the graph wired to nothing — dropped in, to be connected after. */
export function placeChainNode(dir: string, module: string): string {
  const node = nodeArg(dir, module);
  return editGraph(dir, (doc) => addNode(doc, node));
}

/** Pin every node in `at` that has no pin yet — one write, for a graph recording where it drew itself. */
export function setChainNodePositions(
  dir: string,
  at: Record<string, { x: number; y: number }>,
): string {
  return editGraph(dir, (doc) => setNodePositions(doc, at));
}

/** Hand EVERY node back to the layout — `graph organize` clearing the pins in one write. */
export function clearChainNodePositions(dir: string): string {
  return editGraph(dir, (doc) => clearNodePositions(doc));
}

/** Pin a node's place on the graph — or, with null, hand it back to the layout. */
export function setChainNodePosition(
  dir: string,
  name: string,
  at: { x: number; y: number } | null,
): string {
  const node = nodeArg(dir, name);
  return editGraph(dir, (doc) => setNodePosition(doc, node, at));
}

/** Draw a new arrow from `from` to `to` (each optionally `name#port`) — the patch-cable gesture's write. */
export function connectChainNodes(
  dir: string,
  from: string,
  to: string,
): string {
  const [a, b] = [nodeArg(dir, from), nodeArg(dir, to)];
  return editGraph(dir, (doc) => connectNodes(doc, a, b));
}

/** Take the arrow from `from` to `to` out — the patch cable pulled and dropped on the canvas. */
export function disconnectChainNodes(
  dir: string,
  from: string,
  to: string,
): string {
  const [a, b] = [nodeArg(dir, from), nodeArg(dir, to)];
  return editGraph(dir, (doc) => disconnectNodes(doc, a, b));
}

/** Move ONE end of an existing arrow — one read and one write, so the cable can never be left half-gone. */
export function replugChainNodes(
  dir: string,
  from: string,
  to: string,
  newFrom: string,
  newTo: string,
): string {
  const [a, b, c, d] = [from, to, newFrom, newTo].map((n) => nodeArg(dir, n));
  return editGraph(dir, (doc) => {
    disconnectNodes(doc, a, b);
    connectNodes(doc, c, d);
  });
}

/** Insert a module into the arrow from `before` to `after` — the two ends the graph was dropped on. */
export function insertChainStep(
  dir: string,
  before: string,
  after: string | undefined,
  module: string,
): string {
  const b = nodeArg(dir, before);
  const a = after === undefined ? undefined : nodeArg(dir, after);
  const m = nodeArg(dir, module);
  return editGraph(dir, (doc) => insertBetween(doc, b, a, m));
}
