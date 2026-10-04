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
  withModuleStamp,
} from "@studio/song/loader";
import { chainsUsing, sharedRoots } from "@studio/song/moduleFork";
import { keepsItsModule, resolveModule } from "@studio/song/moduleResolve";
import { isTrack } from "@studio/song/trackModule";
import { entityFileFor, moduleFileFor } from "@studio/song/yaml/moduleIO";
import { currentAlternative } from "@studio/song-schema/alternatives";
import { currentEngine } from "@studio/song-schema/engines";
import { materialRefOf } from "@studio/song-schema/placementId";
import type { WarpMarker } from "@studio/song-schema/warpPoints";
import {
  addAlternative,
  alternativeNames,
  setAlternativeParam,
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
  return rewriteFile(moduleFileOf(dir, module).path, transform);
}

// Rewrite one file through `transform`, writing only when it changed.
function rewriteFile(
  path: string,
  transform: (text: string) => string,
): string {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  // No format pass afterwards: the YAML writers emit canonical output.
  if (after !== before) writeFileSync(path, after, "utf8");
  return path;
}

// Where a module's file is — a node's own file in the flat `nodes/`, or a shared one at `@workspace`/`@st0`.
function moduleFileOf(
  dir: string,
  module: string,
): { folder: string; path: string } {
  const modules = loadModules(dir) as Record<string, { home?: string }>;
  const b = modules[module];
  // A node carries its own folder — the only shape a project's own `loadModules` returns now.
  if (b?.home) {
    const folder = join(dir, b.home);
    const found = moduleFileFor(folder, b.home, module);
    if (!found) throw new Error(`module "${module}" has no file in ${b.home}`);
    return { folder, path: found.path };
  }
  const shared = sharedModuleFileOf(dir, module);
  if (shared) return shared;
  throw new Error(`no module "${module}" in this project`);
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

// Set one param on a module node — on the attribute set that is ON, so a knob turned on set 2 changes set 2.
export function setModuleParam(
  dir: string,
  module: string,
  name: string,
  value: number,
): string {
  // A module with engines keeps its knobs PER engine, so the one that is on is asked first (docs/engines.md).
  // The reads before the write share one stamp walk; the scope closes BEFORE the write (packages/song/docs/moduleCache.md).
  const { engine, path } = withModuleStamp(dir, () => ({
    engine: engineOn(dir, module),
    path: moduleFileOf(dir, module).path,
  }));
  return rewriteFile(path, (text) =>
    setAlternativeParam(text, name, value, engine),
  );
}

/** The engine a module runs as, resolved like the compile resolves it — undefined for a module with none. */
export function engineOn(dir: string, module: string): string | undefined {
  const node = loadModules(dir)[module];
  return node
    ? currentEngine(resolveModule(node, loadModuleRefs(dir)))
    : undefined;
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

/** Add one and switch to it — empty, or a copy of the set that is on; a LANE's empty one drops its placements, docs/projectEdit.md. */
export function newModuleAlternative(
  dir: string,
  module: string,
  name?: string,
  opts: { copy?: boolean } = {},
): { path: string; name: string } {
  // RESOLVED and not as loaded, because `kind: "track"` lives on the built-in it extends.
  // One stamp walk for the reads, closed before the write, as in setModuleParam.
  const { blankEvents, file } = withModuleStamp(dir, () => {
    const node = loadModules(dir)[module];
    return {
      blankEvents: !!node && isTrack(resolveModule(node, loadModuleRefs(dir))),
      file: moduleFileOf(dir, module).path,
    };
  });
  let chosen = name ?? "";
  const path = rewriteFile(file, (text) => {
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

/** Which CAMERA a live picture node opens, by the LABEL a person reads; empty means the default one.
 *
 * A label and not a deviceId, and the schema's comment says why: an id is salted per browser and
 * per origin, so one written into a committed file names nothing on the next machine. The browser
 * matches this against what it enumerates — see packages/song/docs/camera.md. */
export function setModuleCamera(
  dir: string,
  module: string,
  label: string,
): string {
  // Empty REMOVES the key, exactly as a cleared shader does: `camera: ""` names no camera at all.
  const clean = label.trim();
  return editModuleValue(dir, module, ["camera"], clean || null);
}

/** Choose which MIDI device a midi-in node records from, by its label; empty clears it — any device (packages/song/docs/midiIn.md). */
export function setModuleDevice(
  dir: string,
  module: string,
  label: string,
): string {
  const clean = label.trim();
  return editModuleValue(dir, module, ["device"], clean || null);
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

/** Set an effect's `mix`, the engine's dry/wet around it; 1 (all wet) is no line at all — engine/st0-engine/docs/mix.md. */
export function setModuleMix(dir: string, module: string, mix: number): string {
  if (!Number.isFinite(mix) || mix < 0 || mix > 1)
    throw new Error("a mix is a number from 0 (all dry) to 1 (all wet)");
  return editModuleValue(dir, module, ["mix"], mix >= 1 ? null : mix);
}

/** Set a module's level into (`input_volume`) or out of it (`output_volume`), in dB; 0 is no line at all — engine docs/mix.md. */
export function setModuleVolume(
  dir: string,
  module: string,
  side: "input" | "output",
  db: number,
): string {
  if (!Number.isFinite(db) || db < -60 || db > 12)
    throw new Error("a volume is a number of dB from -60 to +12");
  return editModuleValue(dir, module, [`${side}_volume`], db === 0 ? null : db);
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

/** A lane or its fader keeps its module whatever set is on, so repointing one of its sets is refused — docs/alternatives.md. */
function refuseSwap(dir: string, module: string): void {
  const node = loadModules(dir)[module];
  if (!node) return;
  // Its OWN module, the sets aside: what it is on set "1" is what decides.
  const own = resolveModule(
    { ...node, alternative: undefined },
    loadModuleRefs(dir),
  );
  if (keepsItsModule(own))
    throw new Error(
      `'${module}' is a ${own.kind === "track" ? "lane" : "lane's fader"} — its alternatives can change its settings, not its module`,
    );
}

/** Repoint a node at another module: rewrite its `extends`, keep everything else — docs/projectEdit.md. */
export function setModuleExtends(
  dir: string,
  module: string,
  ref: string,
): { rel: string; dropped: string[]; alternative?: string } {
  if (module === ref) throw new Error(`'${module}' cannot extend itself`);
  const known = projectModules(dir);
  if (!(ref in known)) {
    const refs = baseModuleRefs(known);
    throw new Error(
      `unknown module '${ref}'${refs.length ? ` — this project has: ${refs.join(", ")}` : " — this project has none"}`,
    );
  }
  const dropped: string[] = [];
  let set: string | undefined;
  const path = editModuleFile(dir, module, (text) => {
    const doc = parseDocument(text, { version: "1.2" });
    // On a set other than the first, the SET is repointed: it becomes another module, the node's own untouched.
    const at = currentAlternative(
      (doc.toJS() ?? {}) as { alternatives?: unknown; alternative?: unknown },
    );
    if (at > 0) {
      refuseSwap(dir, module);
      set = alternativeNames(text)[at];
    }
    const base = at > 0 ? ["alternatives", at - 1] : [];
    doc.setIn([...base, "extends"], ref);
    for (const k of DESCRIBES_WHAT_IT_IS)
      if (doc.hasIn([...base, k])) {
        doc.deleteIn([...base, k]);
        dropped.push(k);
      }
    return doc.toString({ lineWidth: 0 });
  });
  return {
    rel: relative(dir, path).split(sep).join("/"),
    dropped,
    ...(set ? { alternative: set } : {}),
  };
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

/**
 * Is `name` on the graph without a file of its own — a MODULE used directly as a node? st0 writes
 * that shape itself (a lane's `mix-<lane>` strip), and an import writes it for a plugin used once,
 * so the node verbs have to know it rather than answering "no such node". See docs/projectEdit.md.
 */
function moduleUsedAsNode(dir: string, name: string): boolean {
  if (entityFileFor(join(dir, "nodes"), "nodes", name)) return false;
  try {
    const text = readFileSync(graphFileOf(dir).path, "utf8");
    const g = parseGraph(text).value;
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
  const found = entityFileFor(join(dir, "nodes"), "nodes", from);
  if (!found) {
    // A module used directly has no instance to rename: the name on the graph IS the module's, and
    // renaming it here would leave the graph naming something no folder answers to.
    if (moduleUsedAsNode(dir, from))
      throw new Error(
        `'${from}' is a module used directly on the graph, not a node of one — rename the module, ` +
          `or give it a node first (\`node new\`) and rename that`,
      );
    throw new Error(`no node '${from}' in this project`);
  }
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
  if (!found) {
    // A module used directly: there is no file to delete, and the MODULE stays — it is a
    // definition, and other chains may name it. What goes is its place in the graph.
    if (moduleUsedAsNode(dir, node)) {
      const { path } = graphFileOf(dir);
      const text = readFileSync(path, "utf8");
      const r = removeNode(text, node);
      if (r.text !== text) writeFileSync(path, r.text, "utf8");
      return { rewired: r.rewired, removed: [] };
    }
    throw new Error(`no node '${node}' in this project`);
  }
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
