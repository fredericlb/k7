// moduleTree.ts — the module folders read in: an external tree's generic modules, a project's
// nodes and its chain items, stamped with their panel and MIDI map. What a reader gets wrong: the
// READ is memoised on the folders' stamp, the validation is not. See docs/loader.md.

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ENGINES_DIR, engineRefOf } from "@studio/song-schema/engines";
import {
  MODULE_TYPES,
  metaRef,
  moduleKey,
  moduleRefOf,
  type PortDef,
} from "@studio/song-schema/moduleTypes";
import { moduleOfItem } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  type NodeItem,
  TRACKS_DIR,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import { basePresetIn, presetFor } from "./basePreset";
import { isChainProject, readChainProject } from "./chainProject";
import { loadControllerLibrary } from "./controller";
import type { Diagnostic } from "./diagnostics";
import { engineRef } from "./engineCatalogue";
import { engineFoldersOf } from "./engines";
import {
  alternativeRacks,
  resolveAssets,
  resolveRackAudio,
} from "./moduleAssetFiles";
import { cachedForModules } from "./moduleCache";
import { dspSourceFor } from "./moduleRefs";
import { mergeAuthored } from "./moduleResolve";
import type { LoadedModule, RawRack } from "./rawDoc";
import { loadUiLibrary, uiWithScript } from "./uiLibrary";
import {
  entityFileFor,
  entityFiles,
  moduleFileFor,
  nodeFiles,
  readModuleFile,
} from "./yaml/moduleIO";
import { wsExists } from "./yaml/workspaceFile";

// A module's ports: its OWN when it declares them, else its type folder's defaults, the two lists independent (docs/ports.md).
function portsOf(
  value: Record<string, unknown> | null | undefined,
  meta: (typeof MODULE_TYPES)[keyof typeof MODULE_TYPES],
): Pick<LoadedModule, "inputs" | "outputs"> {
  const own = (k: "inputs" | "outputs") => {
    const v = value?.[k];
    return Array.isArray(v) && v.length ? (v as PortDef[]) : undefined;
  };
  return {
    inputs: own("inputs") ?? meta.inputs,
    outputs: own("outputs") ?? meta.outputs,
  };
}

export function readModuleTree(
  dir: string,
  root: string,
  key: (type: string, name: string) => string,
  out: Record<string, LoadedModule>,
  // Where a module file that would not READ is reported, because dropping one silently makes every symptom describe something else.
  issues: Diagnostic[] = [],
  // The project these are read FOR: a tap's `@project/` sample is its file.
  project?: string,
): void {
  // `relDir` is the folder's PARENT, `leaf` names the preset/IR, `sub` is the ref suffix ("adt" or "delay/adt").
  const readModule = (
    relDir: string,
    leaf: string,
    sub: string,
    type: string,
    meta: (typeof MODULE_TYPES)[keyof typeof MODULE_TYPES],
    isEngine = false,
  ): void => {
    const folder = join(dir, relDir, leaf);
    const file = moduleFileFor(folder, `${relDir}/${leaf}`, "module");
    if (!file) return;
    const read = readModuleFile(file);
    if (read.issues.length)
      issues.push({
        // Named by its REF, not by a path: the file is outside the project, and the ref is what a chain says.
        file: `${key(type, sub)}/${basename(file.path)}`,
        line: 1,
        col: 1,
        severity: "warning",
        // Phrased to read on its own AND inside a sentence, since the ref check quotes it.
        message: `did not load — ${read.issues.join("; ")}`,
      });
    const m = read.value;
    if (!m) return;
    // Seam cast: the value passed the module schema, so it fits LoadedModule's authored half.
    const decorate = (
      value: Record<string, unknown>,
      node?: string,
    ): LoadedModule =>
      ({
        ...value,
        // A rack module's audio lives in this module's own folder; a tap's `@project/` sample in the project read for.
        rack: value.rack
          ? resolveRackAudio(value.rack as RawRack, folder, project)
          : undefined,
        ...alternativeRacks(value, folder, project),
        kind: meta.kind,
        ...portsOf(value, meta),
        // The type FOLDER and the module's own folder, which is what says whether a midi-input module gives back audio or midi.
        category: type,
        file: leaf,
        node,
        // What state this module loads: its chosen `base:`, else a node's own .vstpreset, else the folder's default.
        preset: presetFor(folder, leaf, node, value.base),
        // …and its DSP source, resolved against ITS OWN folder rather than the opened song: the folder IS the module.
        ...dspSourceFor(value, folder),
        // …and the files its params name, out of its OWN assets/ — a borrowed module brings its own.
        ...resolveAssets(value, folder),
        // Its own folder, so the ancestry fold can resolve a file this module inherits.
        folderAbs: folder,
      }) as LoadedModule;

    // Its ENGINES, each a module of its own under `<ref>/engines/<name>` — never an engine's engines (docs/engines.md).
    const engines = isEngine ? [] : engineFoldersOf(folder);
    const engineRefs = Object.fromEntries(
      engines.map((e) => [e, engineRefOf(key(type, sub), e)]),
    );
    for (const e of engines) {
      readModule(
        `${relDir}/${leaf}/${ENGINES_DIR}`,
        e,
        `${sub}/${ENGINES_DIR}/${e}`,
        type,
        meta,
        true,
      );
      const loaded = out[engineRefs[e]];
      if (loaded) loaded.engineOf = key(type, sub);
    }
    const withEngines = (lm: LoadedModule): LoadedModule =>
      engines.length ? { ...lm, engineRefs } : lm;

    out[key(type, sub)] = withEngines(decorate(m));
    // The nodes beside module.yaml, keyed like a local one under the ref; without these an inherited node is unnameable.
    for (const { node, file: ifile } of nodeFiles(
      folder,
      `${relDir}/${leaf}`,
    )) {
      const value = readModuleFile(ifile).value;
      if (!value || typeof value !== "object") continue;
      const merged = mergeAuthored(m, value);
      merged.ui = value.ui ?? m.ui; // a grid is taken whole, never half-merged (see loadModules)
      out[moduleKey(key(type, sub), node)] = withEngines(
        decorate(merged, node),
      );
    }
  };

  for (const [type, meta] of Object.entries(MODULE_TYPES)) {
    const rel = root ? `${root}/${type}` : type;
    const abs = join(dir, rel);
    if (!wsExists(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs)) {
      const folder = join(abs, name);
      if (!statSync(folder).isDirectory()) continue;
      // A folder with no module file is a CATEGORY (one level deep only — a filing convenience, not real nesting).
      if (moduleFileFor(folder, `${rel}/${name}`, "module")) {
        readModule(rel, name, name, type, meta);
        continue;
      }
      for (const leaf of readdirSync(folder)) {
        const leafFolder = join(folder, leaf);
        if (!statSync(leafFolder).isDirectory()) continue;
        if (!moduleFileFor(leafFolder, `${rel}/${name}/${leaf}`, "module"))
          continue;
        readModule(`${rel}/${name}`, leaf, `${name}/${leaf}`, type, meta);
      }
    }
  }
}

/** What one read of `nodes/` produced: the map, and the two things `validate` judges. */
interface ModulesRead {
  out: Record<string, LoadedModule>;
  /** AS AUTHORED — what validatePlugins reads, kept so a cached read can still be validated. */
  raw: { rel: string; module: Record<string, unknown> }[];
  yamlIssues: string[];
}

// Read a project's `nodes/`, one use of a library module per file, into a { name: module } map — docs/loader.md.
function readModules(dir: string): ModulesRead {
  const out: Record<string, LoadedModule> = {};
  const raw: { rel: string; module: Record<string, unknown> }[] = []; // AS AUTHORED, for validatePlugins below
  const yamlIssues: string[] = []; // held rather than thrown at once, so a load reports every bad file
  loadNodes(dir, out, raw, yamlIssues);
  applyUiLibrary(dir, out, (m) => moduleOwnRefs(m));
  return { out, raw, yamlIssues };
}

// A fresh map of fresh modules, so a cached read never leaves this file — see docs/graphModel.md.
export function cloneModules(
  src: Record<string, LoadedModule>,
): Record<string, LoadedModule> {
  const seen = new Map<LoadedModule, LoadedModule>();
  const out: Record<string, LoadedModule> = {};
  for (const [key, m] of Object.entries(src)) {
    let copy = seen.get(m);
    if (!copy) {
      copy = { ...m };
      seen.set(m, copy);
    }
    out[key] = copy;
  }
  return out;
}

// A project's modules keyed by the name a chain writes; the READ is memoised on the folders' stamp, the validation is not.
export function loadModules(
  dir: string,
  validate = false, // off by default — see docs/loader.md ("loadModules internals")
): Record<string, LoadedModule> {
  const read = cachedForModules(dir, "modules", () => readModules(dir));
  if (validate) {
    if (read.yamlIssues.length)
      // callers already treat "invalid module(s)" as fatal and show it
      throw new Error(`invalid module(s):\n  ${read.yamlIssues.join("\n  ")}`);
    validatePlugins(read.raw);
  }
  return cloneModules(read.out);
}

/** The project's uses of modules: `nodes/<name>.yaml`, flat, filename IS the name. */
export const NODES_DIR = "nodes";

// Load `nodes/` into `out`, keyed by the bare filename, undecorated so inheritance can fill it — see docs/nodes.md.
function loadNodes(
  dir: string,
  out: Record<string, LoadedModule>,
  raw: { rel: string; module: Record<string, unknown> }[],
  yamlIssues: string[],
): void {
  if (isChainProject(dir)) {
    loadChainNodes(dir, out, raw, yamlIssues);
    return;
  }
  const folder = join(dir, NODES_DIR);
  if (!wsExists(folder) || !statSync(folder).isDirectory()) return;
  for (const { id: node, file } of entityFiles(folder, NODES_DIR)) {
    const read = readModuleFile(file);
    yamlIssues.push(...read.issues);
    const value = read.value;
    if (!value || typeof value !== "object") continue;
    // A node file wins a name a module also has, since a module is named by its ref (docs/trackModules.md).
    raw.push({ rel: file.rel, module: value });
    // A node picks its base like anything else it overrides, which is what makes the choice PER INSTANCE.
    const preset = presetFor(folder, node, node, value.base);
    out[node] = {
      ...value,
      // The FILE names it, exactly as it does for a track or a clip — never a `name:` field.
      name: node,
      node,
      file: node,
      home: NODES_DIR, // where its .vstpreset is saved — see nodeProject's presetSave
      // A node without `extends` has no folder to take `kind` from: io by its `io:`, else "plugin" (song-schema/docs/moduleTypes.md).
      ...(typeof value.io === "string"
        ? { kind: "io" }
        : typeof value.extends !== "string"
          ? { kind: "plugin" }
          : {}),
      rack: value.rack
        ? resolveRackAudio(value.rack as RawRack, folder, dir)
        : undefined,
      ...alternativeRacks(value, folder, dir),
      ...(preset ? { preset } : {}),
      ...dspSourceFor(value, folder),
      ...resolveAssets(value, folder),
      // Its own folder, so the ancestry fold can resolve a file this module inherits.
      folderAbs: folder,
    } as LoadedModule;
  }
}

// A chain project's nodes: each item of `chains/`, a lane's from `tracks/` — keyed by lane name or id (docs/chainFiles.md).
function loadChainNodes(
  dir: string,
  out: Record<string, LoadedModule>,
  raw: { rel: string; module: Record<string, unknown> }[],
  yamlIssues: string[],
): void {
  const cp = readChainProject(dir);
  yamlIssues.push(...cp.issues);
  const presets = join(dir, VSTPRESETS_DIR);
  for (const n of Object.values(cp.nodes)) {
    // A PICTURE lane is no module, as in a graph project: its placements are video_tracks/, read by the picture compile.
    if (n.picture) continue;
    let value: Record<string, unknown> | null;
    let rel: string;
    if (n.track) {
      const file = entityFileFor(join(dir, TRACKS_DIR), TRACKS_DIR, n.track);
      if (!file) {
        yamlIssues.push(
          `${CHAINS_DIR}/${n.chain}.yaml: lane "${n.track}" has no ${TRACKS_DIR}/${n.track}.yaml`,
        );
        continue;
      }
      const read = readModuleFile(file);
      yamlIssues.push(...read.issues);
      value = read.value;
      rel = file.rel;
    } else {
      value = moduleOfItem(n.value);
      rel = `${CHAINS_DIR}/${n.chain}.yaml`;
    }
    if (!value || typeof value !== "object") continue;
    raw.push({ rel, module: value });
    // A node's state is `vstpresets/<its vstpreset:>`, defaulting to its id; a chosen `base:` still wins.
    const presetName = n.track
      ? undefined
      : ((n.value as NodeItem).vstpreset ?? `${n.id}.vstpreset`);
    const own =
      presetName && wsExists(join(presets, presetName))
        ? join(presets, presetName)
        : undefined;
    const preset = basePresetIn(presets, value.base) ?? own;
    out[n.name] = {
      ...value,
      name: n.name,
      node: n.name,
      file: n.name,
      home: n.track ? TRACKS_DIR : CHAINS_DIR,
      chain: n.chain,
      nodeId: n.id,
      ...(presetName ? { presetRel: `${VSTPRESETS_DIR}/${presetName}` } : {}),
      ...(typeof value.io === "string"
        ? { kind: "io" }
        : typeof value.extends !== "string"
          ? { kind: "plugin" }
          : {}),
      rack: value.rack
        ? resolveRackAudio(value.rack as RawRack, dir, dir)
        : undefined,
      ...alternativeRacks(value, dir, dir),
      ...(preset ? { preset } : {}),
      ...dspSourceFor(value, dir),
      ...resolveAssets(value, dir),
      folderAbs: dir,
    } as LoadedModule;
  }
}

// The refs a local module's OWN FILES may be filed under, best first — its own, then what it derives from (docs/graphModel.md).
export function moduleOwnRefs(m: LoadedModule): string[] {
  const from = typeof m.extends === "string" ? m.extends : "";
  // An io role is a built-in, not a scanned plugin — its panel (if any) is filed under `@meta`.
  const ambientRef =
    m.kind === "io" ? metaRef(String(m.file)) : engineRef(String(m.file));
  // A node has no type folder and so no ref of its own: its panel is the panel of what it uses.
  if (!m.category) return from ? [from] : [ambientRef];
  const own = moduleRefOf(String(m.category), String(m.file));
  return from ? [own, from] : [own, ambientRef];
}

// Overlay the panels found beside the modules onto a module map, by ref, replacing a module's own `ui:` WHOLE (docs/uiLibrary.md).
export function applyUiLibrary(
  dir: string,
  out: Record<string, LoadedModule>,
  // One ref, or several tried in order, first hit winning — so the specific beats the general.
  refOf: (m: LoadedModule, key: string) => string | string[],
): void {
  // Under the module stamp, so the modules and the refs share ONE read of every panel: each is a deep clone.
  const ui = cachedForModules(dir, "uiLibrary", () => loadUiLibrary(dir));
  const cc = cachedForModules(dir, "controllerLibrary", () =>
    loadControllerLibrary(dir),
  );
  applyByRef(out, refOf, ui.byRef, "ui", uiWithScript);
  applyByRef(out, refOf, cc.byRef, "cc", (e) => e.cc);
}

/** Stamp a folder-keyed sibling file onto every module that answers to its ref; the panel and the MIDI map differ only in field. */
function applyByRef<E>(
  out: Record<string, LoadedModule>,
  refOf: (m: LoadedModule, key: string) => string | string[],
  byRef: Record<string, E>,
  field: string,
  valueFor: (entry: E) => unknown,
): void {
  const entries = Object.entries(out);
  if (!entries.length || !Object.keys(byRef).length) return;
  for (const [key, m] of entries) {
    const refs = refOf(m, key);
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const hit = byRef[ref];
      if (hit) {
        (m as unknown as Record<string, unknown>)[field] = valueFor(hit);
        break;
      }
    }
  }
}

// The plugin FORMATS the engine loads — keep in step with the engine's isExternalFormat (see docs/loader.md).
export const KNOWN_PLUGIN_TYPES = new Set([
  "internal",
  "vst3",
  "vst",
  "vst2",
  "au",
  "audiounit",
  "clap",
  "lv2",
  "ladspa",
  "aax",
]);

// The one plugin rule that still BLOCKS the compile: a KNOWN format must name its plugin (see docs/loader.md).
function validatePlugins(
  raw: { rel: string; module: Record<string, unknown> }[],
): void {
  const errs: string[] = [];
  for (const { rel, module } of raw) {
    const p = module?.plugin as { type?: unknown; name?: unknown } | undefined;
    if (!p || typeof p !== "object") continue; // no own plugin — nothing to check
    const type = String(p.type ?? "").toLowerCase();
    if (!KNOWN_PLUGIN_TYPES.has(type)) continue; // not_supported / unknown — flagged, not errored
    const name = p.name != null ? String(p.name) : "";
    if (!name)
      errs.push(
        `${rel}: plugin.name is required — for "internal" the built-in's xmlTypeName (e.g. "4osc"), else the external plugin's name`,
      );
  }
  if (errs.length)
    throw new Error(`invalid module(s):\n  ${errs.join("\n  ")}`);
}
