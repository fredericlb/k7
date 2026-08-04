// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadModules, splitModuleKey } from "@studio/song/loader";
import { sharedRoots } from "./moduleFork";
import {
  addNode,
  insertBetween,
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

// Where a module's file is — `module.yaml`, or an instance's own file beside it.
function moduleFileOf(
  dir: string,
  module: string,
): { folder: string; path: string } {
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string; instance?: string }
  >;
  const b = modules[module];
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
  const isInstance = key.includes(":");
  // An instance is one file; a generic takes its folder, and everything in it.
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
