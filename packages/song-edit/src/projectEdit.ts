// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, sep } from "node:path";
import {
  baseModuleRefs,
  loadModuleRefs,
  loadModules,
  projectModules,
  splitModuleKey,
} from "@studio/song/loader";
import { chainsUsing, sharedRoots } from "@studio/song/moduleFork";
import { resolveModule } from "@studio/song/moduleResolve";
import { isTrack } from "@studio/song/trackModule";
import { entityFileFor, moduleFileFor } from "@studio/song/yaml/moduleIO";
import { currentAlternative } from "@studio/song-schema/alternatives";
import { materialRefOf } from "@studio/song-schema/placementId";
import type { WarpMarker } from "@studio/song-schema/warpPoints";
import {
  addAlternative,
  alternativeNames,
  setAlternative,
} from "@studio/song-schema/yaml/alternativeFile";
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
import {
  setModuleAutomation,
  setModuleList,
  setModuleValue,
} from "@studio/song-schema/yaml/moduleFile";
import { parseDocument, parse as parseYaml } from "yaml";
import type { OnsetEdits } from "./onsets";

// --- module files -------------------------------------------------------------

// Rewrite a module's node file in place, resolved through loadModules — so "synth:lead" edits its OWN file.
export function editModuleFile(
  dir: string,
  module: string,
  transform: (text: string) => string,
): string {
  const { path } = moduleFileOf(dir, module);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  // No format pass afterwards: the YAML writers emit canonical output.
  if (after !== before) writeFileSync(path, after, "utf8");
  return path;
}

// Where a module's file is — `module.yaml`, or a node's own file in the flat `nodes/`.
function moduleFileOf(
  dir: string,
  module: string,
): { folder: string; path: string } {
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string; node?: string; home?: string }
  >;
  const b = modules[module];
  // A node carries its own folder, and has no category to rebuild one from.
  if (b?.home) {
    const folder = join(dir, b.home);
    const found = moduleFileFor(folder, b.home, module);
    if (!found) throw new Error(`module "${module}" has no file in ${b.home}`);
    return { folder, path: found.path };
  }
  if (!b?.category || !b?.file) {
    const shared = sharedModuleFileOf(dir, module);
    if (shared) return shared;
    throw new Error(`no module "${module}" in this project`);
  }
  const folder = join(dir, "modules", b.category, b.file); // module.* for the generic, <node>.* beside it
  const relDir = `modules/${b.category}/${b.file}`;
  const found = moduleFileFor(folder, relDir, b.node ?? "module");
  if (!found) throw new Error(`module "${module}" has no file in ${relDir}`);
  return { folder, path: found.path };
}

/** The same for a SHARED catalogue module, whose file lives in the workspace's `_modules` — see docs/projectEdit.md. */
function sharedModuleFileOf(
  dir: string,
  key: string,
): { folder: string; path: string } | null {
  if (!key.startsWith("@")) return null;
  const { module, node } = splitModuleKey(key);
  const [ns, ...rest] = module.slice(1).split("/");
  const root = sharedRoots(dir).find((r) => r.ns === ns)?.root;
  if (!root || !rest.length) return null;
  // The ref IS the path inside its catalogue — that is how readModuleTree keyed it.
  const folder = join(root, ...rest);
  const found = moduleFileFor(folder, "", node ?? "module");
  return found ? { folder, path: found.path } : null;
}

/** Bind a curve to a module's param — null unbinds, and `trigger` names whose note-ons restart an envelope. */
export function setModuleAutomationBinding(
  dir: string,
  module: string,
  param: string,
  curve: string | null,
  trigger?: string,
): string {
  return editModuleFile(dir, module, (text) =>
    setModuleAutomation(text, param, curve, trigger),
  );
}

/** Set (or remove, with `null`) one value in a module file — changes that value and nothing else, comments and layout included. */
function editModuleValue(
  dir: string,
  module: string,
  path: string[],
  value: number | string | null,
): string {
  return editModuleFile(dir, module, (text) =>
    setModuleValue(text, path, value),
  );
}

// Set one param on a module node, leaving the rest of the file untouched.
export function setModuleParam(
  dir: string,
  module: string,
  name: string,
  value: number,
): string {
  return editModuleValue(dir, module, ["params", name], value);
}

/** What a module's file says its attribute SETS are called, and which is on — read off the FILE, docs/projectEdit.md. */
export function moduleAlternatives(
  dir: string,
  module: string,
): { names: string[]; current: string } {
  const text = readFileSync(moduleFileOf(dir, module).path, "utf8");
  const names = alternativeNames(text);
  return {
    names,
    current:
      names[currentAlternative(parseYaml(text, { version: "1.2" }) ?? {})],
  };
}

/** Switch a module to another of its attribute SETS by name — see packages/song/docs/alternatives.md. */
export function selectModuleAlternative(
  dir: string,
  module: string,
  name: string,
): string {
  return editModuleFile(dir, module, (text) => setAlternative(text, name));
}

/** Add one and switch to it — empty, or a copy of the set that is on; a LANE's empty one drops its placements, docs/projectEdit.md. */
export function newModuleAlternative(
  dir: string,
  module: string,
  name?: string,
  opts: { copy?: boolean } = {},
): { path: string; name: string } {
  // RESOLVED and not as loaded, because `kind: "track"` lives on the built-in it extends.
  const node = loadModules(dir)[module];
  const blankEvents =
    !!node && isTrack(resolveModule(node, loadModuleRefs(dir)));
  let chosen = name ?? "";
  const path = editModuleFile(dir, module, (text) => {
    const made = addAlternative(text, name, { ...opts, blankEvents });
    chosen = made.name;
    return made.text;
  });
  return { path, name: chosen };
}

/** Point a module at its render, or clear it — refused on a SHARED one, see packages/song/docs/freeze.md. */
export function setModuleFrozen(
  dir: string,
  module: string,
  render: string | null,
): string {
  if (module.startsWith("@"))
    throw new Error(
      `'${module}' comes from a shared catalogue — freeze the node that uses it, not the module itself`,
    );
  return editModuleValue(dir, module, ["frozen"], render);
}

/** Set a live input's `monitor` (`off` | `auto` | `on`) — a FIELD rather than a param, docs/projectEdit.md. */
export function setModuleMonitor(
  dir: string,
  module: string,
  value: "off" | "auto" | "on",
): string {
  return editModuleValue(dir, module, ["monitor"], value);
}

/** Choose which SHADER this node runs — a folder under `shaders/`, empty clears it; not checked, docs/projectEdit.md. */
export function setModuleShader(
  dir: string,
  module: string,
  name: string,
): string {
  // Empty REMOVES the key rather than writing `shader: ""`, which the schema's `min(1)` refuses.
  const clean = name.trim();
  return editModuleValue(dir, module, ["shader"], clean || null);
}

/** Choose which named BASE this module starts from, per instance — see packages/song/docs/userPresets.md. */
export function setModuleBase(
  dir: string,
  module: string,
  name: string,
): string {
  // Empty REMOVES the key rather than writing `base: ""` — `setModuleValue` deletes on null.
  const clean = name.trim();
  return editModuleValue(dir, module, ["base"], clean || null);
}

/** Set a live input's `gain` — the interface trim in dB, 0 being unity, and deliberately unclamped. */
export function setModuleInputGain(
  dir: string,
  module: string,
  db: number,
): string {
  if (!Number.isFinite(db)) throw new Error("a gain is a number of decibels");
  return editModuleValue(dir, module, ["gain"], db);
}

/** Set a live input's `channel` — one for mono, two for a stereo pair the interface really groups, docs/projectEdit.md. */
export function setModuleChannel(
  dir: string,
  module: string,
  channels: number[],
): string {
  if (!channels.length) throw new Error("an input needs at least one channel");
  if (channels.length > 2)
    throw new Error("an input is one channel or a stereo pair, not more");
  if (channels.some((n) => !Number.isInteger(n) || n < 1))
    throw new Error("channels are whole numbers counted from 1");
  return editModuleFile(dir, module, (text) =>
    setModuleList(text, ["channel"], channels),
  );
}

/** Point a file-valued param at one of the module's own assets, ASSETS-RELATIVE — a param like any other. */
export function setModuleAsset(
  dir: string,
  module: string,
  param: string,
  file: string | null,
): string {
  return editModuleValue(dir, module, ["params", param], file);
}

// --- clip files ---------------------------------------------------------------

/** A clip's own file, from either of its two names — half the callers hold a PLACEMENT id, docs/projectEdit.md. */
function clipFileOf(dir: string, id: string): ReturnType<typeof entityFileFor> {
  return entityFileFor(join(dir, "clips"), "clips", materialRefOf(id));
}

/** …and when there is none, say what was LOOKED FOR and not only what was asked. */
function missingClip(id: string): string {
  const ref = materialRefOf(id);
  return ref === id
    ? `no clip "${id}" in this project — clips/${id}.yaml does not exist`
    : `no clip "${id}" in this project — clips/${ref}.yaml does not exist`;
}

/** Write a clip's onset CORRECTIONS — the block that outlives a re-detection; corrections that cancel out remove the key. */
export function setClipOnsets(
  dir: string,
  ref: string,
  edits: OnsetEdits,
): string {
  const file = clipFileOf(dir, ref);
  if (!file) throw new Error(missingClip(ref));
  const empty = !edits.added?.length && !edits.removed?.length;
  const before = readFileSync(file.path, "utf8");
  const after = setModuleValue(before, ["onsets"], empty ? null : edits);
  if (after !== before) writeFileSync(file.path, after, "utf8");
  return file.path;
}

/** Read a clip's `[timelineBeat, sourceSecond]` pairs exactly as the file states them, or null — never an identity map. */
export function clipWarpMarkers(dir: string, ref: string): WarpMarker[] | null {
  const raw = parseYaml(readFileSync(clipFilePath(dir, ref), "utf8"), {
    version: "1.2",
  }) as { warp?: { markers?: unknown } } | null;
  const m = raw?.warp?.markers;
  if (!Array.isArray(m)) return null;
  const out = m
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2)
    .map(([b, s]): WarpMarker => [Number(b), Number(s)]);
  return out.length ? out : null;
}

/** Write a clip's stretch map; `algorithm` is only used when the block is CREATED, and the engine ignores it. */
export function setClipWarp(
  dir: string,
  ref: string,
  markers: WarpMarker[],
  algorithm = "elastique",
): string {
  const path = clipFilePath(dir, ref);
  const before = readFileSync(path, "utf8");
  const doc = parseDocument(before, { version: "1.2" });
  if (!doc.getIn(["warp", "algorithm"]))
    doc.setIn(["warp", "algorithm"], algorithm);
  // One pair per line, inline — the shape the importer writes and the one a person can read.
  const seq = doc.createNode(markers.map((m) => [m[0], m[1]]));
  for (const item of (seq as { items?: { flow?: boolean }[] }).items ?? [])
    item.flow = true;
  doc.setIn(["warp", "markers"], seq);
  const after = String(doc);
  if (after !== before) writeFileSync(path, after, "utf8");
  return path;
}

/** Where a clip's own file is — exported so the undo journal can back it up BEFORE asking for a write. */
export function clipFilePath(dir: string, ref: string): string {
  const file = clipFileOf(dir, ref);
  if (!file) throw new Error(missingClip(ref));
  return file.path;
}

/** A clip's onset corrections as its file holds them — `{}` when it has none. */
export function clipOnsets(dir: string, ref: string): OnsetEdits {
  const file = clipFileOf(dir, ref);
  if (!file) return {};
  try {
    const raw = parseYaml(readFileSync(file.path, "utf8"), { version: "1.2" });
    const o = (raw as { onsets?: OnsetEdits } | null)?.onsets;
    return {
      ...(o?.added?.length ? { added: [...o.added] } : {}),
      ...(o?.removed?.length ? { removed: [...o.removed] } : {}),
    };
  } catch {
    return {}; // a malformed clip file is the loader's error to report, not this reader's
  }
}

// --- chains file --------------------------------------------------------------

/** The graph file a folder holds — a project's, or a library CHAIN's, which is the same file; docs/projectEdit.md. */
function graphFileOf(dir: string): { path: string } {
  const file = entityFileFor(dir, "", GRAPH_BASE);
  if (!file) throw new Error(`${dir}: no ${GRAPH_FILE}`);
  return { path: file.path };
}

/** Bypass (or re-enable) a module — off-then-on returns the file to what it was, and no chain need be named. */
export function setModuleBypass(
  dir: string,
  module: string,
  bypassed: boolean,
): string {
  const { path } = graphFileOf(dir);
  const before = readFileSync(path, "utf8");
  const after = setModuleEnabled(before, module, !bypassed);
  if (after !== before) writeFileSync(path, after, "utf8");
  return path;
}

/** What a module file says about WHAT IT IS — repointing its `extends` drops these, docs/projectEdit.md. */
const DESCRIBES_WHAT_IT_IS = ["plugin", "params", "rack"] as const;

/** Repoint a node at another module: rewrite its `extends`, keep everything else — docs/projectEdit.md. */
export function setModuleExtends(
  dir: string,
  module: string,
  ref: string,
): { rel: string; dropped: string[] } {
  if (module === ref) throw new Error(`'${module}' cannot extend itself`);
  const known = projectModules(dir);
  if (!(ref in known)) {
    const refs = baseModuleRefs(known);
    throw new Error(
      `unknown module '${ref}'${refs.length ? ` — this project has: ${refs.join(", ")}` : " — this project has none"}`,
    );
  }
  const dropped: string[] = [];
  const path = editModuleFile(dir, module, (text) => {
    const doc = parseDocument(text, { version: "1.2" });
    doc.setIn(["extends"], ref);
    for (const k of DESCRIBES_WHAT_IT_IS)
      if (doc.hasIn([k])) {
        doc.deleteIn([k]);
        dropped.push(k);
      }
    return doc.toString({ lineWidth: 0 });
  });
  return { rel: relative(dir, path).split(sep).join("/"), dropped };
}

/** Take a node out of the SIGNAL PATH, joining what fed it to what it fed, and leave it in the graph wired to nothing. */
export function unlinkChainNode(
  dir: string,
  node: string,
): { rewired: string[] } {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const { value, issues } = parseGraph(text);
  if (!value)
    throw new Error(`${GRAPH_FILE}: ${issues[0]?.message ?? "unreadable"}`);
  // The last module in a run has no entry of its own, and is still in the chain and unlinkable.
  const isDest = Object.values(value.modules ?? {}).some((dests) =>
    dests.includes(node),
  );
  if (!(node in (value.modules ?? {})) && !isDest)
    throw new Error(`no '${node}' in the chains`);

  const r = unlinkNode(text, node);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  return { rewired: r.rewired };
}

/** The lane whose chain plays `node`, or null — the FIRST when several reach it, docs/projectEdit.md. */
export function laneOfNode(dir: string, node: string): string | null {
  try {
    const text = readFileSync(graphFileOf(dir).path, "utf8");
    return chainsUsing(text, node)[0] ?? null;
  } catch {
    return null; // no graph, or one that will not read — a node with no run to be named after
  }
}

/** Rename a node: its file, its preset, and every trace of it in the chains — the order is load-bearing, docs/projectEdit.md. */
export function renameChainNode(
  dir: string,
  from: string,
  to: string,
): { moved: string[]; rewired: string[] } {
  const found = entityFileFor(join(dir, "nodes"), "nodes", from);
  if (!found) throw new Error(`no node '${from}' in this project`);
  const ext = extname(found.path);
  const destAbs = join(dir, "nodes", `${to}${ext}`);
  if (existsSync(destAbs))
    throw new Error(`nodes/${to}${ext} already exists — refusing to overwrite`);
  const moved = [`${found.rel} → nodes/${to}${ext}`];
  renameSync(found.path, destAbs);
  const preset = join(dir, "nodes", `${from}.vstpreset`);
  if (existsSync(preset)) {
    renameSync(preset, join(dir, "nodes", `${to}.vstpreset`));
    moved.push(`nodes/${from}.vstpreset → nodes/${to}.vstpreset`);
  }
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const r = renameNode(text, from, to);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  return { moved, rewired: r.rewired };
}

/** Delete a node: its file, its preset, and every trace of it in the chains — files first, docs/projectEdit.md. */
export function deleteChainNode(
  dir: string,
  node: string,
): { rewired: string[]; removed: string[] } {
  const found = entityFileFor(join(dir, "nodes"), "nodes", node);
  if (!found) throw new Error(`no node '${node}' in this project`);
  const removed = [found.rel];
  rmSync(found.path, { force: true });
  // Its own preset, when it has one — `nodes/<node>.vstpreset` (see loader's ancestry fold).
  const preset = join(dir, "nodes", `${node}.vstpreset`);
  if (existsSync(preset)) {
    rmSync(preset, { force: true });
    removed.push(`nodes/${node}.vstpreset`);
  }
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const r = removeNode(text, node);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  return { rewired: r.rewired, removed };
}

/** Put a module in the graph wired to nothing — dropped in, to be connected after. */
export function placeChainNode(dir: string, module: string): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = addNode(text, module);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Pin every node in `at` that has no pin yet — one write, for a graph recording where it drew itself. */
export function setChainNodePositions(
  dir: string,
  at: Record<string, { x: number; y: number }>,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = setNodePositions(text, at);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Hand EVERY node back to the layout — `graph organize` clearing the pins in one write. */
export function clearChainNodePositions(dir: string): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = clearNodePositions(text);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Pin a node's place on the graph — or, with null, hand it back to the layout. */
export function setChainNodePosition(
  dir: string,
  node: string,
  at: { x: number; y: number } | null,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = setNodePosition(text, node, at);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Draw a new arrow from `from` to `to` (each optionally `name#port`) — the patch-cable gesture's write. */
export function connectChainNodes(
  dir: string,
  from: string,
  to: string,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = connectNodes(text, from, to);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Take the arrow from `from` to `to` out — the patch cable pulled and dropped on the canvas. */
export function disconnectChainNodes(
  dir: string,
  from: string,
  to: string,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = disconnectNodes(text, from, to);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Move ONE end of an existing arrow — one read and one write, so the cable can never be left half-gone. */
export function replugChainNodes(
  dir: string,
  from: string,
  to: string,
  newFrom: string,
  newTo: string,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = connectNodes(disconnectNodes(text, from, to), newFrom, newTo);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}

/** Insert a module into the arrow from `before` to `after` — the two ends the graph was dropped on. */
export function insertChainStep(
  dir: string,
  before: string,
  after: string | undefined,
  module: string,
): string {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = insertBetween(text, before, after, module);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}
