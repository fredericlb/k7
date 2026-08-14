// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  loadModuleRefs,
  loadModules,
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
  insertBetween,
  parseChains,
  removeNode,
  renameNode,
  setModuleEnabled,
} from "./yaml/chainsFile";
import { setMaterialWindow } from "./yaml/materialFile";
import { setModuleList, setModuleValue } from "./yaml/moduleFile";
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
 * A LANE's empty one is empty of PLACEMENTS (`blankClips`), because a new take that opens holding
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
  const blankClips =
    !!node && isTrack(resolveModule(node, loadModuleRefs(dir)));
  let chosen = name ?? "";
  const path = editModuleFile(dir, module, (text) => {
    const made = addAlternative(text, name, { ...opts, blankClips });
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

/** The project's chains file. */
function chainsFileOf(dir: string): { path: string } {
  const file = entityFileFor(dir, "", "chains");
  if (!file) throw new Error(`${dir}: no chains file`);
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
  const { path } = chainsFileOf(dir);
  const before = readFileSync(path, "utf8");
  const after = setModuleEnabled(before, module, !bypassed);
  if (after !== before) writeFileSync(path, after, "utf8");
  return path;
}

/**
 * Delete a module and every chain step naming it, returning what was touched.
 *
 * A module is a FOLDER; a node is one file inside it. Deleting `synth:lead` removes `lead.yaml` and leaves
 * the generic alone, while deleting `synth` removes the whole folder — nodes cannot outlive their parent.
 * The chain references go either way, because a step naming a module that no longer exists is exactly the
 * dangling reference the compiler refuses to load: removing the file has to mean removing the references, or
 * "delete" leaves the project unopenable.
 */
export function deleteModule(
  dir: string,
  key: string,
): { removed: string; rewired: string[] } {
  const { folder, path } = moduleFileOf(dir, key);
  // A node is one FILE in the shared `nodes/` folder — removing that folder would take
  // every other use of every other module with it. A module still takes its own folder whole.
  const isNode = !!(loadModules(dir) as Record<string, { home?: string }>)[key]
    ?.home;
  if (isNode) rmSync(path, { force: true });
  else rmSync(folder, { recursive: true, force: true });
  const removed = relative(dir, isNode ? path : folder)
    .split(sep)
    .join("/");

  let rewired: string[] = [];
  try {
    const { path: chainsPath } = chainsFileOf(dir);
    const text = readFileSync(chainsPath, "utf8");
    const r = removeNode(text, key);
    if (r.text !== text) writeFileSync(chainsPath, r.text, "utf8");
    rewired = r.rewired;
  } catch {
    // No chains file, or one this cannot parse. The module is gone either way, which is what was asked.
  }
  return { removed, rewired };
}

/**
 * Point every chain step naming `from` at `to`, then delete `from`'s files.
 *
 * The order matters and is the whole design: the chains are rewritten FIRST, so at no instant does a chain name
 * a module that does not exist. Doing it the other way round leaves a window — and if the rename then failed,
 * a permanently broken project.
 */
export function replaceModuleInChains(
  dir: string,
  from: string,
  to: string,
): { removed: string; rewired: string[] } {
  const { path } = chainsFileOf(dir);
  const text = readFileSync(path, "utf8");
  const r = renameNode(text, from, to);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  // Now nothing refers to it, so removing its files cannot dangle. deleteModule's own chain sweep finds nothing.
  const { removed } = deleteModule(dir, from);
  return { removed, rewired: r.rewired };
}

/**
 * Take a node OUT of the chains, joining what fed it to what it fed — and leave its files alone.
 *
 * The whole difference from `deleteModule` is that last clause. A node you unlink is still
 * on disk with its settings intact, so putting it back is `chain add`; deleting it is not
 * undoable that way. Taking a module out of the signal path and getting rid of it are two
 * different intentions, and only one of them had a command.
 *
 * A LANE used to be refused here, because a chain started at it and there was nothing feeding it
 * to rejoin to what it feeds. A lane is a module now, with an input port of its own
 * (docs/trackModules.md), so the splice is well defined: it leaves the signal path and its file
 * stays on disk with its clips — which is exactly what unlinking means everywhere else.
 */
export function unlinkChainNode(
  dir: string,
  node: string,
): { rewired: string[] } {
  const { path } = chainsFileOf(dir);
  const text = readFileSync(path, "utf8");
  const { value, issues } = parseChains(text);
  if (!value)
    throw new Error(`chains.yaml: ${issues[0]?.message ?? "unreadable"}`);
  // Named as a step, or only ever as somebody's destination: the last module in a run has no
  // entry of its own, and it is still in the chain and still unlinkable.
  const isDest = Object.values(value.modules ?? {}).some((dests) =>
    dests.includes(node),
  );
  if (!(node in (value.modules ?? {})) && !isDest)
    throw new Error(`no '${node}' in the chains`);

  const r = removeNode(text, node);
  if (r.text !== text) writeFileSync(path, r.text, "utf8");
  return { rewired: r.rewired };
}

/** Put a module in the graph wired to nothing — dropped in, to be connected after. */
export function placeChainNode(dir: string, module: string): string {
  const { path } = chainsFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = addNode(text, module);
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
  const { path } = chainsFileOf(dir);
  const text = readFileSync(path, "utf8");
  const next = insertBetween(text, before, after, module);
  if (next !== text) writeFileSync(path, next, "utf8");
  return path;
}
