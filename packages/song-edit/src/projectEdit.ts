// projectEdit.ts — changing a PROJECT in its own vocabulary ("set `Filter Freq` on
// module `synth`"): finds the file a name lives in and hands the change to its writer.
// Not yaml/edit.ts (the FILE primitive) — this knows modules, not YAML. Every write
// changes the value and nothing else — comments, key order and layout all survive.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { chainItemText, editChainItem } from "@studio/song/chainItemEdit";
import {
  baseModuleRefs,
  loadModuleRefs,
  loadModules,
  projectModules,
  splitModuleKey,
  withModuleStamp,
} from "@studio/song/loader";
import { sharedRoots } from "@studio/song/moduleFork";
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
  return rewriteModule(moduleFileOf(dir, module), transform);
}

/** Where a module's text is: a file of its own, or — `item` set — an item of a chain file. */
interface ModuleText {
  path: string;
  dir?: string;
  item?: string;
}

// Rewrite a module's text through `transform`, writing only when it changed; the file's path.
function rewriteModule(
  at: ModuleText,
  transform: (text: string) => string,
): string {
  if (at.item && at.dir) return editChainItem(at.dir, at.item, transform);
  const before = readFileSync(at.path, "utf8");
  const after = transform(before);
  // No format pass afterwards: the YAML writers emit canonical output.
  if (after !== before) writeFileSync(at.path, after, "utf8");
  return at.path;
}

// What a module's text says — a chain node's item cut out as a node file would hold it.
const readModuleText = (at: ModuleText): string =>
  at.item && at.dir
    ? chainItemText(at.dir, at.item)
    : readFileSync(at.path, "utf8");

// Where a module's file is — a node's own file in the flat `nodes/`, or a shared one at `@workspace`/`@st0`.
function moduleFileOf(dir: string, module: string): ModuleText {
  const modules = loadModules(dir) as Record<
    string,
    { home?: string; chain?: string }
  >;
  const b = modules[module];
  // A chain project's node (not a lane) is an item of its chain file — docs/chainFiles.md.
  if (b?.home === "chains" && b.chain)
    return { path: join(dir, "chains", `${b.chain}.yaml`), dir, item: module };
  // A node carries its own folder — the only shape a project's own `loadModules` returns now.
  if (b?.home) {
    const folder = join(dir, b.home);
    const found = moduleFileFor(folder, b.home, module);
    if (!found) throw new Error(`module "${module}" has no file in ${b.home}`);
    return { path: found.path };
  }
  const shared = sharedModuleFileOf(dir, module);
  if (shared) return shared;
  throw new Error(`no module "${module}" in this project`);
}

/** The same for a SHARED catalogue module, whose file lives in the workspace's `_modules` — see docs/projectEdit.md. */
function sharedModuleFileOf(dir: string, key: string): ModuleText | null {
  if (!key.startsWith("@")) return null;
  const { module, node } = splitModuleKey(key);
  const [ns, ...rest] = module.slice(1).split("/");
  const root = sharedRoots(dir).find((r) => r.ns === ns)?.root;
  if (!root || !rest.length) return null;
  // The ref IS the path inside its catalogue — that is how readModuleTree keyed it.
  const folder = join(root, ...rest);
  const found = moduleFileFor(folder, "", node ?? "module");
  return found ? { path: found.path } : null;
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
  const { engine, at } = withModuleStamp(dir, () => ({
    engine: engineOn(dir, module),
    at: moduleFileOf(dir, module),
  }));
  return rewriteModule(at, (text) =>
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
  const text = readModuleText(moduleFileOf(dir, module));
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
      file: moduleFileOf(dir, module),
    };
  });
  let chosen = name ?? "";
  const path = rewriteModule(file, (text) => {
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

/** Point a file-valued param at one of the module's own assets, ASSETS-RELATIVE — a param like any other, so it lands where setModuleParam's would. */
export function setModuleAsset(
  dir: string,
  module: string,
  param: string,
  file: string | null,
): string {
  const { engine, at } = withModuleStamp(dir, () => ({
    engine: engineOn(dir, module),
    at: moduleFileOf(dir, module),
  }));
  return rewriteModule(at, (text) =>
    setAlternativeParam(text, param, file, engine),
  );
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

// --- the graph: graphEdit.ts, re-exported so a caller keeps one import ---

export {
  clearChainNodePositions,
  connectChainNodes,
  deleteChainNode,
  disconnectChainNodes,
  insertChainStep,
  laneOfNode,
  placeChainNode,
  renameChainNode,
  replugChainNodes,
  setChainNodePosition,
  setChainNodePositions,
  setModuleBypass,
  unlinkChainNode,
} from "./graphEdit";
