// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadModules, splitModuleKey } from "@studio/song/loader";
import { parse as parseYaml } from "yaml";
import { sharedRoots } from "./moduleFork";
import type { OnsetEdits } from "./onsets";
import {
  addNode,
  insertBetween,
  parseChains,
  removeNode,
  renameNode,
  setModuleEnabled,
} from "./yaml/chainsFile";
import { setModuleValue } from "./yaml/moduleFile";
import { entityFileFor, moduleFileFor } from "./yaml/moduleIO";

// --- module files -------------------------------------------------------------

// Rewrite a module's instance file in place, resolved through loadModules — so "synth:lead" edits its OWN file.
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

// Where a module's file is — `module.yaml`, or an instance's own file in the flat `instances/`.
function moduleFileOf(
  dir: string,
  module: string,
): { folder: string; path: string } {
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string; instance?: string; home?: string }
  >;
  const b = modules[module];
  // An instance carries its own folder, and has no category to rebuild one from.
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
  const folder = join(dir, "modules", b.category, b.file); // module.* for the generic, <instance>.* beside it
  const relDir = `modules/${b.category}/${b.file}`;
  const found = moduleFileFor(folder, relDir, b.instance ?? "module");
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
  const { module, instance } = splitModuleKey(key);
  const [ns, ...rest] = module.slice(1).split("/");
  const root = sharedRoots(dir).find((r) => r.ns === ns)?.root;
  if (!root || !rest.length) return null;
  // The ref IS the path inside its catalogue — that is how readModuleTree keyed it.
  const folder = join(root, ...rest);
  const found = moduleFileFor(folder, "", instance ?? "module");
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

// Set one param on a module instance, leaving the rest of the file untouched.
export function setModuleParam(
  dir: string,
  module: string,
  name: string,
  value: number,
): string {
  return editModuleValue(dir, module, ["params", name], value);
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
 * Point a file-valued param at one of the module's own assets (or clear it), ASSETS-RELATIVE —
 * the short form the module file carries.
 *
 * The same path as setModuleParam, because it IS a param: it lands in `params:` beside the
 * numbers, so an instance overriding just the model is the same edit as overriding a gain.
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
 * A module is a FOLDER; an instance is one file inside it. Deleting `synth:lead` removes `lead.yaml` and leaves
 * the generic alone, while deleting `synth` removes the whole folder — instances cannot outlive their parent.
 * The chain references go either way, because a step naming a module that no longer exists is exactly the
 * dangling reference the compiler refuses to load: removing the file has to mean removing the references, or
 * "delete" leaves the project unopenable.
 */
export function deleteModule(
  dir: string,
  key: string,
): { removed: string; rewired: string[] } {
  const { folder, path } = moduleFileOf(dir, key);
  // An instance is one FILE in the shared `instances/` folder — removing that folder would take
  // every other use of every other module with it. A module still takes its own folder whole.
  const isInstance = !!(loadModules(dir) as Record<string, { home?: string }>)[
    key
  ]?.home;
  if (isInstance) rmSync(path, { force: true });
  else rmSync(folder, { recursive: true, force: true });
  const removed = relative(dir, isInstance ? path : folder)
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
 * The whole difference from `deleteModule` is that last clause. An instance you unlink is still
 * on disk with its settings intact, so putting it back is `chain add`; deleting it is not
 * undoable that way. Taking a module out of the signal path and getting rid of it are two
 * different intentions, and only one of them had a command.
 *
 * A TRACK is refused rather than spliced: a track is where a chain STARTS, so it has nothing
 * feeding it to rejoin to what it feeds — `removeNode` would rewrite its destinations and leave
 * the track itself in place, which is not what "unlink" would have meant.
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
  if (node in (value.tracks ?? {}))
    throw new Error(
      `'${node}' is a track — a chain starts there, so there is nothing to splice around`,
    );
  // Named as a step, or only ever as somebody's destination: the last module in a run has no
  // entry of its own, and it is still in the chain and still unlinkable.
  const isDest = [
    ...Object.values(value.tracks ?? {}),
    ...Object.values(value.modules ?? {}),
  ].some((dests) => dests.includes(node));
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
