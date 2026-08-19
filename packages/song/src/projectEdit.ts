// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  baseModuleRefs,
  loadModuleRefs,
  loadModules,
  projectModules,
  splitModuleKey,
} from "@studio/song/loader";
import { parseDocument, parse as parseYaml } from "yaml";
import { currentAlternative } from "./alternatives";
import { sharedRoots } from "./moduleFork";
import { resolveModule } from "./moduleResolve";
import type { OnsetEdits } from "./onsets";
import { isTrack } from "./trackModule";
import type { WarpMarker } from "./warpPoints";
import {
  addAlternative,
  alternativeNames,
  setAlternative,
} from "./yaml/alternativeFile";
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
  unlinkNode,
} from "./yaml/graphFile";
import { GRAPH_BASE, GRAPH_FILE } from "./yaml/graphSchema";
import { setMaterialWindow } from "./yaml/materialFile";
import {
  setModuleAutomation,
  setModuleList,
  setModuleValue,
} from "./yaml/moduleFile";
import { entityFileFor, moduleFileFor } from "./yaml/moduleIO";

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

/**
 * The same, for a module of a SHARED catalogue — `"@engine/io/IN:in-2"`, whose file lives in the workspace's
 * `_modules`, not in this project. Null when the name is not a namespaced ref.
 *
 * Writing there changes the module for every project beside it, which is right for what lives on one — an
 * input's `channel:` describes the desk, and so does whether that input is audible. It is NOT a general licence
 * to edit the library: `forkSharedModule` still owns the case where an edit belongs to one song, and the file
 * service still refuses the library outright. Only a caller that has decided otherwise reaches this.
 */
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

/**
 * Bind a curve to a module's param — the file half of the cable dropped on a knob.
 *
 * `curve` null takes the binding away. `trigger` names the module whose note-ons restart an
 * envelope; absent means the module being automated, which is what the compiler assumes.
 */
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

/**
 * What a module's file says its attribute SETS are called, and which is on.
 *
 * Off the FILE rather than off the compiled doc: an alternative may change any field, so the doc
 * carries the chosen one already merged in and has nothing left to say about the others. Here
 * beside the writers so `moduleFileOf` stays private — one place knows where a module's file is.
 */
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

/**
 * Switch a module to another of its attribute SETS, by name. Answers the file that changed.
 *
 * Through `editModuleFile` like every other module edit, so it resolves a node to its own
 * file and a `synth:lead` to the one beside its generic. See docs/alternatives.md.
 */
export function selectModuleAlternative(
  dir: string,
  module: string,
  name: string,
): string {
  return editModuleFile(dir, module, (text) => setAlternative(text, name));
}

/**
 * Add one and switch to it — empty, or a copy of the set that is on. Answers the name it got.
 *
 * A LANE's empty one is empty of PLACEMENTS (`blankEvents`), because a new take that opens holding
 * the previous take's clips is not a new take. Resolved here and not in the document editor: the
 * question is what this module extends, and the vocabulary to answer it lives on this side.
 */
export function newModuleAlternative(
  dir: string,
  module: string,
  name?: string,
  opts: { copy?: boolean } = {},
): { path: string; name: string } {
  // RESOLVED, not as loaded: `loadModules` hands back the node with its `extends` still a string,
  // and `kind: "track"` lives on the built-in it extends. Both reads are memoised on the module
  // folders' stamp, so this costs a directory walk and not a re-read. A name that resolves to
  // nothing simply is not a lane, which leaves the old behaviour.
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

/**
 * Point a module at its render, or clear it (`null`). Answers the file that changed.
 *
 * Refused on a SHARED module. `frozen:` is a fact about this song's signal path — the render was
 * bounced from these lanes — and a catalogue module is beside every project at once, so writing it
 * there would freeze a reverb in songs that have never been rendered. `monitor:` goes the other
 * way deliberately (an input's audibility describes the desk); this one does not.
 *
 * See docs/freeze.md.
 */
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

/**
 * Set a live input's `monitor` — whether the interface signal is audible (`off` | `auto` | `on`).
 *
 * A module FIELD, not a param: an io module has no plugin, so there is nothing to send this to. The engine
 * learns it by rebuilding the track's input, which is why the caller reloads rather than patching.
 */
export function setModuleMonitor(
  dir: string,
  module: string,
  value: "off" | "auto" | "on",
): string {
  return editModuleValue(dir, module, ["monitor"], value);
}

/**
 * Choose which named BASE this module starts from — `base/<name>.vstpreset` in its folder or an
 * ancestor's. Empty clears it, back to the module's plain default state.
 *
 * PER INSTANCE, because `editModuleValue` writes the module's own file and a node has one: two
 * nodes of the same module can sit on two different bases, which is the point of choosing at all.
 *
 * A field, not a param, and the difference decides how it takes effect: the engine learns a base
 * by REBUILDING the module — a `.vstpreset` is loaded when the plugin is created — so this writes
 * and the project reloads. There is nothing live to set, exactly as for `@monitor`.
 *
 * What it cannot disturb is what the module already said. The engine loads the base and then
 * applies `params:` over it, so every value authored in the module still wins; a base only
 * decides what text could not have said. See docs/userPresets.md.
 */
export function setModuleBase(
  dir: string,
  module: string,
  name: string,
): string {
  // Empty REMOVES the key rather than writing `base: ""` — `setModuleValue` deletes on null, and
  // a module with no base is one with no line about it, not one holding an empty name.
  const clean = name.trim();
  return editModuleValue(dir, module, ["base"], clean || null);
}

/**
 * Set a live input's `gain` — the interface trim, in dB, 0 being unity.
 *
 * A module FIELD like `monitor` and `channel`, and the third of the three an input answers.
 * Unclamped: Tracktion does not clamp it either, and what is USEFUL (±24 dB, the range the
 * builder's binds declare) is a judgement for the surface offering the control, not for the
 * writer taking a number someone typed.
 */
export function setModuleInputGain(
  dir: string,
  module: string,
  db: number,
): string {
  if (!Number.isFinite(db)) throw new Error("a gain is a number of decibels");
  return editModuleValue(dir, module, ["gain"], db);
}

/**
 * Set a live input's `channel` — which interface channels it listens on, 1-based.
 *
 * One for mono, two for a stereo pair, and the two-element form only ever means a pair the interface
 * actually groups: `findWaveInput` matches a device on its exact channel list, so a set the rig does
 * not offer resolves to nothing and plays as silence (see engine/moteur/docs/audioDevice.md).
 * Whether such a pair exists is the ENGINE's business and not checkable from here — this writes what
 * it is told, and the surface that offers the choice is the one that only offers real ones.
 *
 * A module FIELD like `monitor`, and it may land in the same shared file for the same reason: which
 * socket an input is on describes the desk, not the song.
 */
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

/**
 * Point a file-valued param at one of the module's own assets (or clear it), ASSETS-RELATIVE —
 * the short form the module file carries.
 *
 * The same path as setModuleParam, because it IS a param: it lands in `params:` beside the
 * numbers, so a node overriding just the model is the same edit as overriding a gain.
 * Clearing takes the key away rather than writing `""`, which would be a value meaning nothing.
 */
export function setModuleAsset(
  dir: string,
  module: string,
  param: string,
  file: string | null,
): string {
  return editModuleValue(dir, module, ["params", param], file);
}

// --- clip files ---------------------------------------------------------------

/**
 * Write a clip's onset CORRECTIONS — the block that outlives a re-detection (see song/onsets.ts).
 *
 * Corrections that cancel out take the key away rather than writing `onsets: {}`: a clip nobody has corrected
 * must read exactly as it did before anyone opened it, or every take in a session grows an empty block that
 * says nothing and shows up in every diff.
 */
export function setClipOnsets(
  dir: string,
  ref: string,
  edits: OnsetEdits,
): string {
  const file = entityFileFor(join(dir, "clips"), "clips", ref);
  if (!file) throw new Error(`no clip "${ref}" in this project`);
  const empty = !edits.added?.length && !edits.removed?.length;
  const before = readFileSync(file.path, "utf8");
  const after = setModuleValue(before, ["onsets"], empty ? null : edits);
  if (after !== before) writeFileSync(file.path, after, "utf8");
  return file.path;
}

/**
 * Set a clip's WINDOW — which span of its source file it plays, in seconds.
 *
 * What `clip trim` writes. It moves the window and never the audio: a take's head is the tail of a
 * count-in and its foot is a room, and both are things you stop playing rather than things you want
 * destroyed. One line to put back, where a rewritten file is a restore from the undo journal.
 *
 * Answers the file it changed, like every writer here.
 */
export function setClipWindow(
  dir: string,
  ref: string,
  from: number,
  to: number,
): string {
  const path = clipFilePath(dir, ref);
  if (!(to > from)) throw new Error("a clip's window has to have some length");
  setMaterialWindow(path, from, to);
  return path;
}

/**
 * Read a clip's stretch map, or null when it has none.
 *
 * `[timelineBeat, sourceSecond]` pairs, exactly as the file states them — no resolution, no
 * defaulting: a clip with no `warp:` has no map, which is a different thing from an identity one.
 */
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

/**
 * Write a clip's stretch map. `algorithm` is only used when the block is being CREATED.
 *
 * The engine ignores the algorithm entirely — it realises a warp through Tracktion's auto-tempo,
 * so the name is documentation of where the map came from and nothing else (see applyClipWarp).
 * It is written because the schema requires it, and kept when one is already there.
 */
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

/** Where a clip's own file is. Exported so a caller can back it up BEFORE asking for a write —
 *  the undo journal wants the version that is about to be replaced, not the replacement. */
export function clipFilePath(dir: string, ref: string): string {
  const file = entityFileFor(join(dir, "clips"), "clips", ref);
  if (!file) throw new Error(`no clip "${ref}" in this project`);
  return file.path;
}

/** A clip's onset corrections as its file holds them — `{}` when it has none. */
export function clipOnsets(dir: string, ref: string): OnsetEdits {
  const file = entityFileFor(join(dir, "clips"), "clips", ref);
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

/**
 * The graph file a folder holds — a project's, or a library CHAIN's, which is the same file.
 *
 * Every verb below goes through this one function, which is what lets the graph editor act on a
 * chain template without a single verb knowing it might be one. That costs nothing to arrange
 * because a chain is not a lookalike: it is a folder holding a `graph.yaml` and a `nodes/`, the
 * same two things a project holds, differing only in having no `project.yaml` and in naming its
 * ends `@in`/`@out`.
 */
function graphFileOf(dir: string): { path: string } {
  const file = entityFileFor(dir, "", GRAPH_BASE);
  if (!file) throw new Error(`${dir}: no ${GRAPH_FILE}`);
  return { path: file.path };
}

/**
 * Bypass (or re-enable) a module. Un-bypassing takes the name back out of `bypassed`, so off-then-on returns the
 * file to what it was.
 *
 * No chain to name any more: the file names each module once, so there is one thing to toggle rather than one
 * per chain the module happened to sit in.
 */
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

/** What a module file says about WHAT IT IS, as opposed to where it sits or how it looks.
 *  Repointing its `extends` drops these: they described the thing it used to be, and left
 *  behind they would either outrank the new ref (`plugin`, which wins over an inherited one)
 *  or address knobs and sounds it has not got. */
const DESCRIBES_WHAT_IT_IS = ["plugin", "params", "rack"] as const;

/**
 * Repoint a node (or a module) at another module: rewrite its `extends`, keep everything else.
 *
 * This is what "replace" means on a node. The name stays, so every chain step naming it keeps
 * its place and nothing is rewired; the file stays, so its position on the graph, its panel and
 * its alternatives survive. Only what it IS changes — which is one line.
 *
 * The ref is checked against the project's real vocabulary rather than a guessed path: an
 * inherited `@ns/…` has no local file to stat, and a typo must be refused before anything is
 * written. Repointing something at itself is refused for the same reason the resolver guards
 * its walk — an `extends` cycle resolves to nothing at all.
 */
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

// `deleteModule` was here: it removed a module's file or folder AND every chain step naming
// it, since a step pointing at a module that is gone is a dangling reference the compiler
// refuses to load. It went with the `module delete` verb that was its only caller — removing a
// module's files is the file tree's business now, and `unlinkChainNode` below is the other half
// it used to bundle in.

/**
 * Take a node out of the SIGNAL PATH, joining what fed it to what it fed — and leave it in the
 * graph, wired to nothing.
 *
 * Its files are untouched and so is its place on the canvas: unlinking is "take it out of the
 * run", not "get rid of it". Putting it back is `node insert`. Removing it altogether — the
 * files and the entry — is `node delete`.
 *
 * A LANE used to be refused here, because a chain started at it and there was nothing feeding it
 * to rejoin to what it feeds. A lane is a module now, with an input port of its own
 * (docs/trackModules.md), so the splice is well defined: it leaves the signal path and its file
 * stays on disk with its events — which is exactly what unlinking means everywhere else.
 */
export function unlinkChainNode(
  dir: string,
  node: string,
): { rewired: string[] } {
  const { path } = graphFileOf(dir);
  const text = readFileSync(path, "utf8");
  const { value, issues } = parseGraph(text);
  if (!value)
    throw new Error(`${GRAPH_FILE}: ${issues[0]?.message ?? "unreadable"}`);
  // Named as a step, or only ever as somebody's destination: the last module in a run has no
  // entry of its own, and it is still in the chain and still unlinkable.
  const isDest = Object.values(value.modules ?? {}).some((dests) =>
    dests.includes(node),
  );
  if (!(node in (value.modules ?? {})) && !isDest)
    throw new Error(`no '${node}' in the chains`);

  const r = unlinkNode(text, node);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  return { rewired: r.rewired };
}

/**
 * Delete a node: its file, its preset, and every trace of it in the chains.
 *
 * The order is load-bearing. The FILES go first and the chains second, because the state to
 * avoid at all costs is a `graph.yaml` naming a node with no file — that is what stops the
 * project loading, and it is the one of the two halves that a person cannot see. Interrupted the
 * other way round you get an orphan file, which loads fine and is merely untidy.
 *
 * The MODULE it uses is left alone. A node is one use of one; deleting the last use is not a
 * statement about the thing being used, and other projects read the same module.
 */
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

/**
 * Move ONE end of an existing arrow: `from → to` becomes `newFrom → newTo` — the re-plug
 * gesture. One read and one write, so however the two halves are spelt the file changes
 * atomically: a crash between "pulled" and "plugged" cannot leave the cable half-gone.
 */
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
