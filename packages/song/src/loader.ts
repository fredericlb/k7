// loader.ts — shared helpers for reading a YAML folder project: each subdirectory holds one flat file per
// entity, keyed by filename, and the root holds project/settings/chains. Read in-process and validated with
// Zod, which carries the file, line and column of a bad key into the diagnostics.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import {
  FAUST_FILE,
  FAUST_TYPE,
  JSDSP_FILE,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
import { instanceName } from "@studio/song-schema/instanceName";
import {
  categoryForRole,
  FILE_PARAMS,
  isFileParam,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleLabelOf,
  moduleRefOf,
  NODE_SEP,
  NOT_SUPPORTED_TYPE,
  type PortDef,
  slugifyPluginName,
  splitModuleKey,
  TRACK_REF,
} from "@studio/song-schema/moduleTypes";
import { ENTITY_SCHEMAS } from "@studio/song-schema/yaml/entitySchemas";
import { parseGraph as parseGraphYaml } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import {
  cueRefs,
  MIX_BASE,
  parseMix as parseMixYaml,
} from "@studio/song-schema/yaml/mixFile";
import { formatIssue } from "@studio/song-schema/yaml/moduleFile";
import {
  ProjectFileSchema,
  SettingsSchema,
} from "@studio/song-schema/yaml/projectSchema";
import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";
import {
  MODULE_ASSETS_DIR,
  MODULE_SOURCES_DIR,
  resolveModuleAssetIn,
  resolveModuleFileIn,
} from "./assetPath";
import { presetFor } from "./basePreset";
import { loadControllerLibrary } from "./controller";
import { studioModules } from "./docModule";
import { engineModules, engineRef } from "./engineCatalogue";
import { cachedForModules, withModuleStamp } from "./moduleCache";
import {
  mergeAuthored,
  resolveModuleMap,
  resolveModuleRef,
} from "./moduleResolve";
import { notSupportedRefs } from "./notSupportedModule";
import type {
  LoadedModule,
  RawProjectRoot,
  RawRack,
  RawVideoTrack,
} from "./rawDoc";
import { moduleLibraryDirs, moduleNamespaceOf } from "./sharedFolders";
import { type Lane, lanesOf, trackModules } from "./trackModule";
import { loadUiLibrary } from "./uiLibrary";
import { setFileValue } from "./yaml/edit";
import {
  entityFileFor,
  entityFiles,
  moduleFileFor,
  nodeFiles,
  readModuleFile,
} from "./yaml/moduleIO";
import { parsedYaml } from "./yaml/yamlCache";

// The module vocabulary lives in moduleTypes.ts, a leaf with no filesystem; re-exported here where every consumer looks.
export {
  categoryForRole,
  FILE_PARAMS,
  // …and the question every writer of one asks: is this param's value a FILE?
  isFileParam,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
  NODE_SEP,
  slugifyPluginName,
  splitModuleKey,
};

// Video source extensions — clips/ holds both kinds identically ({source}), so the kind is read off the extension.
export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm", ".mkv"];
export const isVideoSource = (source: string): boolean =>
  VIDEO_EXT.some((e) => source.toLowerCase().endsWith(e));

// The entities in a subdirectory, keyed by id ({} if the subdir doesn't exist).
export const exportSub = (dir: string, sub: string): any =>
  readYamlEntities(dir, sub).values;

// The YAML entities in `sub` keyed by id, validated against the kind's schema when there is one (yaml/entitySchemas.ts).
export function readYamlEntities(
  dir: string,
  sub: string,
): { values: Record<string, unknown>; issues: string[] } {
  const values: Record<string, unknown> = {};
  const issues: string[] = [];
  const folder = join(dir, sub);
  if (!existsSync(folder)) return { values, issues };
  const schema = (ENTITY_SCHEMAS as Record<string, ZodType | undefined>)[sub];
  for (const { id, file } of entityFiles(folder, sub)) {
    // Cached only when a schema will rebuild the result, since a cached object handed out raw is a shared object.
    const raw = schema
      ? parsedYaml(file.path)
      : parseYaml(readFileSync(file.path, "utf8"), { version: "1.2" });
    if (!schema) {
      values[id] = raw;
      continue;
    }
    const r = schema.safeParse(raw ?? {});
    if (r.success) values[id] = r.data;
    else
      for (const i of r.error.issues)
        issues.push(
          `${file.rel}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
        );
  }
  return { values, issues };
}

// Rewrite a rack's audio refs to ABSOLUTE paths in the declaring folder, so racks merge without tracking provenance.
export function resolveRackAudio(
  rack: RawRack | undefined,
  folderAbs: string,
): RawRack | undefined {
  if (!rack || typeof rack !== "object") return rack;
  // `sources/` first, then `assets/`, then loose beside module.yaml — a rack files its audio under
  // `sources/` (docs/moduleAssets.md) and every older layout still loads.
  const at = (f: unknown) =>
    typeof f === "string" && f
      ? isAbsolute(f)
        ? f
        : (resolveModuleFileIn(f, [folderAbs], MODULE_SOURCES_DIR) ??
          resolveModuleAsset(f, folderAbs) ??
          join(folderAbs, f))
      : f;
  const symbols: NonNullable<RawRack["symbols"]> = {};
  for (const [sym, e] of Object.entries(rack.symbols ?? {}))
    symbols[sym] = e && typeof e === "object" ? { ...e, clip: at(e.clip) } : e;
  return { ...rack, source: at(rack.source), symbols };
}

// --- a module's own assets (see docs/moduleAssets.md) ----------------------------

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

/** Where a module keeps the files it loads: defined in assetPath.ts, re-exported here where every caller already looks. */
export { MODULE_ASSETS_DIR, MODULE_SOURCES_DIR };

/** What an asset folder holds — one extension per file-valued param, see FILE_PARAMS. */
const ASSET_EXT = [".nam", ".onnx"];

// A module's own `assets/<ref>`, confined to that folder, with the machine's model cache as the ONE fallback (docs/moduleAssets.md).
export function resolveModuleAsset(
  ref: unknown,
  folderAbs: string | undefined,
): string | undefined {
  return resolveModuleAssetIn(ref, [folderAbs]);
}

// The file-valued params a module names, resolved absolute inside its OWN folder — see docs/moduleAssets.md.
export function resolveAssets(
  m: Record<string, unknown> | null | undefined,
  folderAbs?: string,
): Pick<LoadedModule, "nam" | "assets"> {
  const params = (m?.params ?? {}) as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  const assets: Record<string, string> = {};
  for (const field of FILE_PARAMS) {
    const ref = params[field];
    out[field] = resolveModuleAsset(ref, folderAbs);
    if (typeof ref === "string" && ref) assets[field] = ref;
  }
  return {
    ...out,
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}

// The files a module carries, as `assets/`-relative POSIX paths, walked recursively and kept NESTED (docs/moduleAssets.md).
export function listModuleAssets(folderAbs: string): string[] {
  const MAX_DEPTH = 6;
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // no assets/ folder, or unreadable — an empty list, not an error
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(join(abs, e.name), child, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = e.name.slice(e.name.lastIndexOf(".")).toLowerCase();
      if (ASSET_EXT.includes(ext)) out.push(child);
    }
  };
  walk(join(folderAbs, MODULE_ASSETS_DIR), "", 0);
  return out.sort();
}

// Read an external `modules_from` tree — only the GENERIC module.yaml, since nodes aren't `extends` targets.
function readModuleTree(
  dir: string,
  root: string,
  key: (type: string, name: string) => string,
  out: Record<string, LoadedModule>,
  // Where a module file that would not READ is reported, because dropping one silently makes every symptom describe something else.
  issues: Diagnostic[] = [],
): void {
  // `relDir` is the folder's PARENT, `leaf` names the preset/IR, `sub` is the ref suffix ("adt" or "delay/adt").
  const readModule = (
    relDir: string,
    leaf: string,
    sub: string,
    type: string,
    meta: (typeof MODULE_TYPES)[keyof typeof MODULE_TYPES],
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
        // A rack module's audio lives in this module's own folder.
        rack: value.rack
          ? resolveRackAudio(value.rack as RawRack, folder)
          : undefined,
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

    out[key(type, sub)] = decorate(m);
    // The nodes beside module.yaml, keyed like a local one under the ref; without these an inherited node is unnameable.
    for (const { node, file: ifile } of nodeFiles(
      folder,
      `${relDir}/${leaf}`,
    )) {
      const value = readModuleFile(ifile).value;
      if (!value || typeof value !== "object") continue;
      const merged = mergeAuthored(m, value);
      merged.ui = value.ui ?? m.ui; // a grid is taken whole, never half-merged (see loadModules)
      out[moduleKey(key(type, sub), node)] = decorate(merged, node);
    }
  };

  for (const [type, meta] of Object.entries(MODULE_TYPES)) {
    const rel = root ? `${root}/${type}` : type;
    const abs = join(dir, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
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

/** What one read of `modules/` + `nodes/` produced: the map, and the two things `validate` judges. */
interface ModulesRead {
  out: Record<string, LoadedModule>;
  /**
   * The module FOLDERS alone, before any node took a name (docs/trackModules.md). A node wins the
   * bare name; the module is still the thing every `@project/…` ref points at, so the ref map is
   * built from here and not from a map a lane may have shadowed.
   */
  folders: Record<string, LoadedModule>;
  /** AS AUTHORED — what validatePlugins reads, kept so a cached read can still be validated. */
  raw: { rel: string; module: Record<string, unknown> }[];
  yamlIssues: string[];
}

// Read a project's modules into a { name: module } map, generic + nodes both keyed in (see docs/loader.md).
function readModules(dir: string): ModulesRead {
  const out: Record<string, LoadedModule> = {};
  const raw: { rel: string; module: Record<string, unknown> }[] = []; // AS AUTHORED, for validatePlugins below
  const yamlIssues: string[] = []; // held rather than thrown at once, so a load reports every bad file
  const bdir = join(dir, "modules");
  for (const [type, meta] of Object.entries(MODULE_TYPES)) {
    const abs = join(bdir, type);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    // The module folders under one type, ONE level of filing allowed — see docs/graphModel.md.
    const folders: { name: string; folder: string }[] = [];
    for (const entry of readdirSync(abs)) {
      const folder = join(abs, entry);
      if (!statSync(folder).isDirectory()) continue;
      if (moduleFileFor(folder, `modules/${type}/${entry}`, "module")) {
        folders.push({ name: entry, folder });
        continue;
      }
      // No module file: a FILING folder, one level only. Its own leaves are the modules.
      for (const leaf of readdirSync(folder)) {
        const leafFolder = join(folder, leaf);
        if (!statSync(leafFolder).isDirectory()) continue;
        if (
          !moduleFileFor(
            leafFolder,
            `modules/${type}/${entry}/${leaf}`,
            "module",
          )
        )
          continue;
        folders.push({ name: `${entry}/${leaf}`, folder: leafFolder });
      }
    }
    for (const { name, folder } of folders) {
      const relDir = `modules/${type}/${name}`;
      // A module folder is its `module.yaml` and nothing else; uses live in the flat `nodes/` (docs/nodes.md).
      const generic = moduleFileFor(folder, relDir, "module");
      let module: Record<string, unknown> | null = null;
      if (generic) {
        const read = readModuleFile(generic);
        yamlIssues.push(...read.issues);
        const value = read.value;
        if (!value || typeof value !== "object") continue;
        module = value;
        raw.push({ rel: generic.rel, module });
      }
      // Adds the LOADER's fields to the generic or a merged node (see docs/loader.md).
      const decorate = (
        value: Record<string, unknown>,
        node?: string,
      ): LoadedModule => {
        // The module's OWN folder name, the last segment of `name`, since its preset sits beside its module.yaml.
        const leaf = name.slice(name.lastIndexOf("/") + 1);
        // The chosen `base:` first, then this node's own, then the generic, so a UI edit never touches a sibling's.
        const preset = presetFor(folder, leaf, node, value.base);
        // Seam cast: `value` passed the module schema (or a merge of two structs that did).
        return {
          ...value,
          name: moduleKey(name, node), // the FOLDER (+ file) names it — not a field
          rack: value.rack // resolved on this copy, not `raw`, so validation sees the authored filename
            ? resolveRackAudio(value.rack as RawRack, folder)
            : undefined,
          category: type, // the module's type folder (io|instruments|audio|transformers|midi)
          file: name, // the module's folder name (modules/<category>/<file>/)
          node, // undefined for the generic; the <node>.yaml basename otherwise
          kind: meta.kind, // derived from the type folder, like a base module others `extends`
          ...portsOf(value, meta),
          preset,
          // The module's own DSP source, resolved against its FOLDER — see dspSourceFor.
          ...dspSourceFor(value, folder),
          // Resolved on this copy, same reason as `rack` above; `folder` is what makes its own assets reachable.
          ...resolveAssets(value, folder),
          // Its own folder, so the ancestry fold can resolve a file this module inherits.
          folderAbs: folder,
        } as LoadedModule;
      };

      if (module) out[name] = decorate(module);
    }
  }
  // Taken before the nodes go in, since that is the point of holding it at all.
  const folders = { ...out };
  loadNodes(dir, out, raw, yamlIssues);
  applyUiLibrary(dir, out, (m) => moduleOwnRefs(m));
  // …and the same panels onto the unshadowed copies, which are what a ref resolves to.
  applyUiLibrary(dir, folders, (m) => moduleOwnRefs(m));
  return { out, folders, raw, yamlIssues };
}

// A fresh map of fresh modules, so a cached read never leaves this file — see docs/graphModel.md.
function cloneModules(
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

// One module-stamp walk for a series of reads, re-exported from moduleCache.ts — usable only by a caller that WRITES nothing.
export { withModuleStamp };

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

/** The module FOLDERS this project holds, unshadowed by its nodes — what a `@project/…` ref means. */
export function projectModuleFolders(
  dir: string,
): Record<string, LoadedModule> {
  return cloneModules(
    cachedForModules(dir, "modules", () => readModules(dir)).folders,
  );
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
  const folder = join(dir, NODES_DIR);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return;
  for (const { id: node, file } of entityFiles(folder, NODES_DIR)) {
    const read = readModuleFile(file);
    yamlIssues.push(...read.issues);
    const value = read.value;
    if (!value || typeof value !== "object") continue;
    // A node file WINS a name a module folder also has — a lane called after the instrument it
    // feeds is what every DAW writes, and a module is named by its ref anyway (docs/trackModules.md).
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
      rack: value.rack
        ? resolveRackAudio(value.rack as RawRack, folder)
        : undefined,
      ...(preset ? { preset } : {}),
      ...dspSourceFor(value, folder),
      ...resolveAssets(value, folder),
      // Its own folder, so the ancestry fold can resolve a file this module inherits.
      folderAbs: folder,
    } as LoadedModule;
  }
}

// The refs a local module's OWN FILES may be filed under, best first — its own, then what it derives from (docs/graphModel.md).
export function moduleOwnRefs(m: LoadedModule): string[] {
  const from = typeof m.extends === "string" ? m.extends : "";
  // A project's own module answers to two refs, bare and "@project/…", so both are tried and a panel drawn once is found.
  const spellings = from
    ? from.startsWith("@project/")
      ? [from, from.slice("@project/".length)]
      : [from, `@project/${from}`]
    : [];
  // A node has no type folder and so no ref of its own: its panel is the panel of what it uses.
  if (!m.category)
    return spellings.length ? spellings : [engineRef(String(m.file))];
  const own = moduleRefOf(String(m.category), String(m.file));
  return spellings.length
    ? [own, ...spellings]
    : [own, engineRef(String(m.file))];
}

// Overlay the panels found beside the modules onto a module map, by ref, replacing a module's own `ui:` WHOLE (docs/uiLibrary.md).
function applyUiLibrary(
  dir: string,
  out: Record<string, LoadedModule>,
  // One ref, or several tried in order, first hit winning — so the specific beats the general.
  refOf: (m: LoadedModule, key: string) => string | string[],
): void {
  applyByRef(out, refOf, loadUiLibrary(dir).byRef, "ui", (e) => e.ui);
  applyByRef(out, refOf, loadControllerLibrary(dir).byRef, "cc", (e) => e.cc);
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

/** One located finding for the editor's inline squiggles; mirrored on the wire by web-shared's Diagnostic. */
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  severity?: "error" | "warning";
}

// The modules of the inherited libraries that would not READ — a warning, becoming an error only once named (docs/graphModel.md).
export function libraryModuleIssues(dir: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  loadModuleRefs(dir, undefined, issues);
  return issues;
}

// Fields a project may still declare that nothing reads, so "accepted" never quietly means "ignored" (docs/sharedFolders.md).
export function deadProjectFields(dir: string): Diagnostic[] {
  let root: RawProjectRoot;
  try {
    root = loadProjectRoot(dir);
  } catch {
    return []; // an unreadable header is the compile's error, not this
  }
  const project = root.project as Record<string, unknown> | undefined;
  // Project-RELATIVE, like every other Diagnostic, because the editor matches these against its own tree paths.
  const file = (
    entityFileFor(dir, "", "project")?.rel ?? "project.yaml"
  ).replace(/^\/+/, "");
  const at = (message: string): Diagnostic => ({
    file,
    line: 1,
    col: 1,
    severity: "warning",
    message,
  });
  const dead = (["modules_from", "libraries_from"] as const)
    .filter((k) => project?.[k] !== undefined)
    .map((k) =>
      at(
        `\`${k}\` is no longer read — the shared folders are found where they sit (../_modules, ../_library, the médiathèque). This line can be deleted.`,
      ),
    );
  // A ROOT sibling rather than a `project:` setting, which is why it is asked separately.
  if (root.type !== undefined)
    dead.push(
      at(
        "`type` is no longer read — the folder's suffix is what says which app opens a project, and there is one dialect left. This line can be deleted.",
      ),
    );
  return dead;
}

export function notSupportedModules(dir: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const authored = loadModules(dir); // authored, no validate
  // RESOLVED, because the marker is usually INHERITED: an import writes a node on `@studio/not-supported`
  // and no module of its own, and the authored file then says nothing at all (docs/notSupported.md).
  const resolved = resolveModuleMap(authored, loadModuleRefs(dir));
  for (const [name, m] of Object.entries(resolved)) {
    const p = m?.plugin;
    if (!p || typeof p !== "object") continue;
    if (String(p.type ?? "").toLowerCase() !== NOT_SUPPORTED_TYPE) continue;
    const own = authored[name];
    out.push({
      // The entry's OWN file, not the generic's — and a node's is flat, with no type folder in it.
      file:
        own?.home === "nodes"
          ? `nodes/${own.file}.yaml`
          : `modules/${m.category}/${m.file}/${m.node ?? "module"}.yaml`,
      line: 1,
      col: 1,
      severity: "warning",
      message: `plugin "${moduleLabelOf(m) || p.name || name}" is not supported — it will be bypassed`,
    });
  }
  return out;
}

// A project's LANES keyed by node name: there is no `tracks/` folder, only the nodes that fold out to one (docs/trackModules.md).
export function loadLanes(dir: string, validate = false): Record<string, Lane> {
  return lanesOf(
    resolveModuleMap(loadModules(dir, validate), loadModuleRefs(dir)),
  );
}

// Video lanes, still an ENTITY of their own (video_tracks/<id>.yaml): picture shares nothing with a song's lanes.
// Through readYamlEntities like clips/, so VideoTrackSchema actually gates the compile — docs/loader.md.
export function loadVideoTracks(
  dir: string,
  validate = false,
): Record<string, RawVideoTrack> {
  const { values, issues } = readYamlEntities(dir, "video_tracks");
  if (validate && issues.length)
    throw new Error(`invalid video track(s):\n  ${issues.join("\n  ")}`);
  return values as Record<string, RawVideoTrack>;
}

// Project settings (settings.yaml), a flat struct; {} when absent, coerced and defaulted by parseSettings.
export function loadSettings(
  dir: string,
  validate = false,
): Record<string, unknown> {
  const found = entityFileFor(dir, "", "settings");
  if (!found) return {};
  const raw = parseYaml(readFileSync(found.path, "utf8"), { version: "1.2" });
  const r = SettingsSchema.safeParse(raw ?? {});
  if (!r.success && validate)
    throw new Error(
      [
        "invalid settings:",
        ...r.error.issues.map(
          (i) =>
            `  ${found.rel}: ${i.path.map(String).join(".")}: ${i.message}`,
        ),
      ].join("\n"),
    );
  return r.success ? r.data : {};
}

// The project's ROOT — `project`, `trackOrder`, `markers` — from `project.yaml`; `chains` is read separately.
export function loadProjectRoot(dir: string, validate = false): RawProjectRoot {
  const file = entityFileFor(dir, "", "project");
  if (!file) return {};
  const raw = parseYaml(readFileSync(file.path, "utf8"), { version: "1.2" });
  const r = ProjectFileSchema.safeParse(raw ?? {});
  if (!r.success) {
    if (validate)
      throw new Error(
        [
          "invalid project:",
          ...r.error.issues.map(
            (i) =>
              `  ${file.rel}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
          ),
        ].join("\n"),
      );
    return {};
  }
  return r.data;
}

// The project's routing segments, from `graph.yaml` when it exists, else inlined in project.yaml (chainsGraph.ts derives the runs).
export function loadChains(
  dir: string,
  root: RawProjectRoot,
  validate = false,
): unknown {
  const file = entityFileFor(dir, "", GRAPH_BASE);
  if (!file) return root?.chains;
  const { value, issues } = parseGraphYaml(readFileSync(file.path, "utf8"));
  if (issues.length && validate)
    throw new Error(
      `invalid chains:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return value;
}

// The songs the desk's CUE SHEET names, from `mix.yaml`, deduplicated and sorted but NOT resolved — see docs/mixFile.md.
export function loadCuedSongs(dir: string, validate = false): string[] {
  const file = entityFileFor(dir, "", MIX_BASE);
  if (!file) return [];
  const { value, issues } = parseMixYaml(readFileSync(file.path, "utf8"));
  if (issues.length && validate)
    throw new Error(
      `invalid cue sheet:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return cueRefs(value);
}

// The DSP source of a module, resolved against its own folder, with the PLUGIN TYPE deciding the filename (docs/graphModel.md).
function dspSourceFor(
  value: Record<string, unknown>,
  folder: string,
): Pick<LoadedModule, "jsdsp" | "faust"> {
  const type = String(
    (value.plugin as { type?: unknown } | undefined)?.type ?? "",
  );
  if (type === JSDSP_TYPE) return { jsdsp: join(folder, JSDSP_FILE) };
  if (type === FAUST_TYPE) return { faust: join(folder, FAUST_FILE) };
  return {};
}

// Every module referenceable by REF, memoised on the module folders' stamp because it reads ~700 YAML files (docs/moduleCache.md).
export function loadModuleRefs(
  dir: string,
  // The ENGINE's own modules, injected because what this machine offers is AMBIENT state a test must be able to withhold.
  catalogue?: Record<string, LoadedModule>,
  // Where a library module that would not read is reported; optional, since only a caller that REPORTS passes an array.
  issues: Diagnostic[] = [],
): Record<string, LoadedModule> {
  if (catalogue === undefined) {
    const hit = cachedForModules(dir, "refs", () => {
      const found: Diagnostic[] = [];
      return {
        out: readModuleRefs(dir, engineModules(), found),
        issues: found,
      };
    });
    issues.push(...hit.issues);
    return cloneModules(hit.out);
  }
  return readModuleRefs(dir, catalogue, issues);
}

function readModuleRefs(
  dir: string,
  catalogue: Record<string, LoadedModule>,
  issues: Diagnostic[],
): Record<string, LoadedModule> {
  // The built-ins first, then the catalogue, so anything on disk overrides both — see docs/graphModel.md.
  const out: Record<string, LoadedModule> = {
    ...studioModules(),
    ...trackModules(),
    ...notSupportedRefs(),
    ...catalogue,
  };

  // Re-key by ref under TWO keys, bare and `@project/…` — from the FOLDERS, so a lane that took a
  // module's bare name leaves the ref it is inherited by alone (docs/trackModules.md).
  for (const m of Object.values(projectModuleFolders(dir))) {
    if (m.node) continue;
    const ref =
      m.category === "io" ? String(m.file) : `${m.category}/${m.file}`;
    out[ref] = m;
    out[`@project/${ref}`] = m;
  }

  // The shared roots, found by LOCATION rather than declared, so a missing folder is simply not a root (docs/sharedFolders.md).
  for (const root of moduleLibraryDirs(dir)) {
    // The level comes from WHERE the root is, not from anything it declares — see moduleNamespaceOf.
    const ns = moduleNamespaceOf(root);
    readModuleTree(
      root,
      "",
      (type, name) => `@${ns}/${type}/${name}`,
      out,
      issues,
    );
  }

  // Panels come from the `ui.yaml` beside each module, keyed by these refs MINUS the node — see docs/uiLibrary.md.
  applyUiLibrary(dir, out, (_m, ref) => splitModuleKey(ref).module);
  return out;
}

/** The ref map for a project — its own modules plus every shared root it inherits; a thin alias, no root being declared. */
export const projectModules = (dir: string): Record<string, LoadedModule> =>
  loadModuleRefs(dir);

// The plugin refs a new module can `extends`: not an io module and not a node, since you extend a module and then instantiate.
export function baseModuleRefs(
  byRef: Record<string, { kind?: string; node?: string }>,
): string[] {
  return Object.entries(byRef)
    .filter(([, m]) => m?.kind === "plugin" && !m?.node)
    .map(([ref]) => ref)
    .sort();
}

/** …for a project, loading its own modules plus everything it inherits. */
export function listBaseModules(dir: string): string[] {
  return baseModuleRefs(projectModules(dir));
}

/** One base module as a PICKER draws it: the ref it is named by, and what it calls itself (docs/moduleLabel.md). */
export interface BaseModuleRef {
  ref: string;
  label?: string;
}

/** …the same list with those labels, off ONE walk — what `/base-modules` answers. */
export function listBaseModuleRefs(dir: string): BaseModuleRef[] {
  const modules = projectModules(dir);
  return baseModuleRefs(modules).map((ref) => {
    const label = moduleLabelOf(modules[ref]);
    return label ? { ref, label } : { ref };
  });
}

// The modules a chain step may name: the project's own, plus only those SHARED refs the chains actually USE.
export function withChainModuleRefs(
  modules: Record<string, LoadedModule>,
  byRef: Record<string, LoadedModule>,
  chains: Record<
    string,
    { use?: { module?: string }[]; out?: { to?: string }[] } | undefined
  >,
): Record<string, LoadedModule> {
  const out = { ...modules };
  // A chain's LAST node is its sink, parsed into `out`, so a ref must arrive here from both or it works only as a step.
  const add = (raw: unknown): void => {
    const name = String(raw ?? "");
    if (!name || out[name] || !byRef[name]) return;
    out[name] = resolveModuleRef(name, byRef) ?? byRef[name];
  };
  for (const c of Object.values(chains ?? {})) {
    for (const s of c?.use ?? []) add(s?.module);
    for (const o of c?.out ?? []) add(o?.to);
  }
  return out;
}

// Create `nodes/<id>.yaml` — a LANE and nothing else, with no kind, appending to `trackOrder` only when there is one.
export function createTrackFile(dir: string, id: string): string[] {
  // The filename is the id, and the id is what a chain's key names.
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid track name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `nodes/${id}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`track '${id}' already exists (${rel})`);
  // A module of that name is NOT in the way: the lane takes the bare name and the module keeps its
  // ref, which is the only way a node names one anyway (docs/trackModules.md). `freeNodeName`
  // proposes past both, so nothing shadows anything by accident.

  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, rel),
    [`extends: "${TRACK_REF}"`, "events: []", ""].join("\n"),
    "utf8",
  );

  const root = loadProjectRoot(dir, true);
  if (Array.isArray(root.trackOrder)) {
    const projectFile = entityFileFor(dir, "", "project");
    if (projectFile)
      setFileValue(projectFile.path, ["trackOrder"], [...root.trackOrder, id]);
  }
  return [rel];
}

/** State a lane order in `project.yaml` — the song's lanes, or its picture's, which are two lists (docs/trackKind.md). */
export function setLaneOrder(
  dir: string,
  which: "trackOrder" | "layers",
  order: string[],
): string {
  const projectFile = entityFileFor(dir, "", "project");
  if (!projectFile)
    throw new Error("no project.yaml — there is nowhere to state a lane order");
  setFileValue(
    projectFile.path,
    which === "layers" ? ["project", "layers"] : ["trackOrder"],
    order,
  );
  // `rel` carries a leading slash, its "sub" being the root; a log line is a path a reader retypes.
  return projectFile.rel.replace(/^\//, "");
}

/** Create `video_tracks/<id>.yaml` AND list `<id>` in `project.layers` — two writes and ONE act (packages/song-video/docs/picture.md). */
export function createVideoTrackFile(dir: string, id: string): string[] {
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid lane name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `video_tracks/${id}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`picture lane '${id}' already exists (${rel})`);
  // The graph draws a song's lanes and its picture lanes in ONE name space, so the two cannot share a name.
  if (existsSync(join(dir, "nodes", `${id}.yaml`)) || id in loadModules(dir))
    throw new Error(`'${id}' is already a track or a module in this project`);
  // Looked up BEFORE either write: an orphan lane file would fail the compile until somebody listed it by hand.
  const projectFile = entityFileFor(dir, "", "project");
  if (!projectFile)
    throw new Error(
      "no project.yaml — a picture lane has nowhere to be listed",
    );
  const layers = loadProjectRoot(dir, true).project?.layers;

  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  // No x/y/w/h: a lane stating no rect fills the frame, which is what a new one should do (song-video/docs/picture.md).
  writeFileSync(join(dir, rel), ["events: []", ""].join("\n"), "utf8");
  // Appended, so the new lane draws LAST — on top, where you can see what you just made.
  setFileValue(
    projectFile.path,
    ["project", "layers"],
    [...(Array.isArray(layers) ? layers.map(String) : []), id],
  );
  // The project file's rel carries a leading slash, its "sub" being the root; the log line is a path a reader retypes.
  return [rel, projectFile.rel.replace(/^\//, "")];
}

// Create `sequences/<id>.yaml` — four empty bars said as the sequence's own window, since no notes means nothing to measure.
export function createSequenceFile(dir: string, id: string): string[] {
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid sequence name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `sequences/${id}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`sequence '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "sequences"), { recursive: true });
  writeFileSync(
    join(dir, rel),
    ['from: "1:1"', 'to: "5:1"', "notes: []", ""].join("\n"),
    "utf8",
  );
  return [rel];
}

export function createModuleFile(
  dir: string,
  category: string,
  module: string,
  extendsRef?: string,
): string {
  // Only known type folders are ever scanned — refuse rather than write something inert.
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(module))
    throw new Error(
      `invalid module name '${module}' — letters, digits, '_' and '-' only`,
    );
  // Checked against the real vocabulary, not a guessed path: an inherited "@ns/…" ref has no local file to stat.
  if (extendsRef) {
    const known = projectModules(dir);
    if (!(extendsRef in known)) {
      const refs = Object.keys(known).sort();
      throw new Error(
        `unknown module '${extendsRef}'${refs.length ? ` — this project has: ${refs.join(", ")}` : " — this project has none"}`,
      );
    }
  }
  // Explicit name, so a clash is reported, not silently renamed around.
  if (module in loadModules(dir))
    throw new Error(`module '${module}' already exists in this project`);
  const rel = `modules/${category}/${module}/module.yaml`; // the folder is named by the module; the file inside is always module.yaml
  if (existsSync(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  mkdirSync(join(dir, "modules", category, module), { recursive: true });
  const body = extendsRef // a flat mapping, no `name:` — the folder names it
    ? `# ${module}: extends module "${extendsRef}".\n` +
      `extends: ${JSON.stringify(extendsRef)}\n`
    : `# ${module}: a bare module. Give it a plugin inline, or extend another module, e.g.\n` +
      `#   extends: instruments/fourosc\n`;
  writeFileSync(join(dir, rel), body, "utf8");
  return rel;
}

// What to call a new use of `module` when nobody said — `<lane>_<module>_<n>`, free across the WHOLE project (instanceName.ts).
export function freeNodeName(
  dir: string,
  module: string,
  lane?: string | null,
): string {
  return instanceName(module, lane, nodeNameTaken(dir));
}

// Is this name already spoken for, as a module OR as a file in `nodes/` — built once so proposing and accepting cannot disagree.
export function nodeNameTaken(dir: string): (name: string) => boolean {
  const taken = loadModules(dir);
  return (n) => n in taken || existsSync(join(dir, NODES_DIR, `${n}.yaml`));
}

// Create one USE of a module: `nodes/<node>.yaml`, FLAT whatever it is a use of — see docs/nodes.md.
export function createNode(
  dir: string,
  category: string,
  module: string,
  node: string,
  // Injected for the same reason loadModuleRefs takes it: what the engine offers is AMBIENT, and a test must not depend on it.
  catalogue: Record<string, LoadedModule> = engineModules(),
): string {
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(node))
    throw new Error(
      `invalid node name '${node}' — letters, digits, '_' and '-' only`,
    );
  const local = moduleFileFor(
    join(dir, "modules", category, module),
    `modules/${category}/${module}`,
    "module",
  );
  const fromEngine = local ? undefined : catalogue[engineRef(module)];
  if (!local && !fromEngine)
    throw new Error(
      `module '${category}/${module}' is neither in this project nor one the engine offers — ` +
        `create it first, or name one of the engine's`,
    );
  // Free among the NODES, which is what the file check below asks. A module of that name is not in
  // the way: the node takes the bare name and the module keeps its ref (docs/trackModules.md).
  const rel = `${NODES_DIR}/${node}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  const plugin = fromEngine?.plugin;
  // The explicit level, which is the form new files are written in — see loadModuleRefs.
  const ref = `@project/${moduleRefOf(category, module)}`;
  const body = local
    ? `# ${node}: one use of module "${category}/${module}".\n` +
      `# It inherits everything that module says — state only what THIS use changes, e.g.\n` +
      `#   params:\n` +
      `#     Filter Freq: 69\n` +
      `extends: ${JSON.stringify(ref)}\n`
    : `# ${node}: one use of "${module}", a module the engine provides.\n` +
      `# The plugin is named here so the project says what it uses, whatever this machine\n` +
      `# has scanned. Add params: to set it.\n` +
      `plugin:\n` +
      `  type: ${JSON.stringify(String(plugin?.type ?? ""))}\n` +
      `  name: ${JSON.stringify(String(plugin?.name ?? ""))}\n`;
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  writeFileSync(join(dir, rel), body, "utf8");
  return rel;
}

// Clone a module folder (nodes, .vstpreset, rack audio) under a new name, rewriting `name:` if present.
export function cloneModuleFile(
  dir: string,
  category: string,
  name: string,
  newName: string,
): string {
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error(
      `invalid module name '${name}' — letters, digits, '_' and '-' only`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(newName))
    throw new Error(
      `invalid new name '${newName}' — letters, digits, '_' and '-' only`,
    );
  if (name === newName)
    throw new Error("source and destination names are the same");
  const srcDir = join(dir, "modules", category, name);
  if (!existsSync(srcDir) || !existsSync(join(srcDir, "module.yaml")))
    throw new Error(`module '${category}/${name}' not found`);
  if (newName in loadModules(dir))
    // destination must not already exist
    throw new Error(
      `module '${category}/${newName}' already exists in this project`,
    );
  const destDir = join(dir, "modules", category, newName);
  if (existsSync(destDir))
    throw new Error(`folder modules/${category}/${newName}/ already exists`);
  cpSync(srcDir, destDir, { recursive: true });
  const modPath = join(destDir, "module.yaml"); // rewritten below if it has a `name:` field
  try {
    const body = readFileSync(modPath, "utf8");
    const rewritten = body.replace(
      /^(name\s*:\s*)"[^"]*"/m,
      `$1${JSON.stringify(newName)}`,
    );
    if (rewritten !== body) writeFileSync(modPath, rewritten, "utf8");
  } catch {
    /* read-only or missing — leave as-is */
  }
  return `modules/${category}/${newName}/module.yaml`;
}
