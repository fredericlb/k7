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
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { JSDSP_FILE, JSDSP_TYPE } from "@studio/engine-protocol/build";
import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";
import { loadControllerLibrary } from "./controller";
import { engineModules, engineRef } from "./engineCatalogue";
import { modelsRoot } from "./modelCache";
import { mergeAuthored, resolveModuleRef } from "./moduleResolve";
import {
  categoryForRole,
  FILE_PARAMS,
  INSTANCE_SEP,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
  type PortDef,
  slugifyPluginName,
  splitModuleKey,
} from "./moduleTypes";
import type {
  LoadedModule,
  RawProjectRoot,
  RawRack,
  RawTrack,
  RawVideoTrack,
} from "./rawDoc";
import { moduleLibraryDirs, moduleNamespaceOf } from "./sharedFolders";
import { loadUiLibrary } from "./uiLibrary";
import { parseChains as parseChainsYaml } from "./yaml/chainsFile";
import { setFileValue } from "./yaml/edit";
import { ENTITY_SCHEMAS } from "./yaml/entitySchemas";
import { MIX_VIEW_BASE, parseMixView, VIEWS_DIR } from "./yaml/mixViewFile";
import type { MixView } from "./yaml/mixViewSchema";
import { formatIssue } from "./yaml/moduleFile";
import {
  entityFileFor,
  entityFiles,
  instanceFiles,
  moduleFileFor,
  readModuleFile,
} from "./yaml/moduleIO";
import { ProjectFileSchema, SettingsSchema } from "./yaml/projectSchema";
import { parseSongs as parseSongsYaml, songRefs } from "./yaml/songsFile";
import { parseTrack } from "./yaml/trackFile";

// The module vocabulary lives in moduleTypes.ts (a leaf, no filesystem) so the engine
// catalogue can share it without importing this file. Re-exported here because this is
// where every consumer already looks for it.
export {
  categoryForRole,
  FILE_PARAMS,
  INSTANCE_SEP,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
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

/**
 * The YAML entities in `sub`, keyed by id (the filename), plus any problems.
 *
 * Validated against the kind's schema when there is one — clips, sequences, curves and
 * video tracks all have one now (yaml/entitySchemas.ts). A folder this doesn't know is
 * read but not checked, rather than refused.
 */
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
    const raw = parseYaml(readFileSync(file.path, "utf8"), { version: "1.2" });
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
  // `assets/` first when the file is actually there, so a rack's samples follow the same
  // convention as `ir`/`nam` — and a shelf laid out the old way, beside module.yaml, still loads.
  const at = (f: unknown) =>
    typeof f === "string" && f
      ? isAbsolute(f)
        ? f
        : (resolveModuleAsset(f, folderAbs) ?? join(folderAbs, f))
      : f;
  const symbols: NonNullable<RawRack["symbols"]> = {};
  for (const [sym, e] of Object.entries(rack.symbols ?? {}))
    symbols[sym] = e && typeof e === "object" ? { ...e, clip: at(e.clip) } : e;
  return { ...rack, source: at(rack.source), symbols };
}

// --- a module's own assets (see docs/moduleAssets.md) ----------------------------

/**
 * A module's ports: its OWN when it declares them, else its type folder's defaults.
 *
 * One rule, one place. `inputs`/`outputs` used to come straight off MODULE_TYPES at three call
 * sites, which is exactly the shape a rule drifts in — and it made a module's port count a
 * property of its FOLDER, so "two audio inputs" could not be said at all. The two lists are
 * independent: a module may name its inputs and inherit its outputs. See docs/ports.md.
 */
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

/** Where a module keeps the files it loads, inside its own folder. */
export const MODULE_ASSETS_DIR = "assets";

/** What an asset folder holds — one extension per file-valued param, see FILE_PARAMS. */
const ASSET_EXT = [".nam", ".onnx"];

/**
 * A module's own `assets/<ref>`, or undefined. Confined to that folder — a `../..` reference
 * is refused rather than resolved, so a module cannot reach outside itself for its sound.
 *
 * Falling back to the machine's model cache is the ONE exception, and it is not a hole in that
 * rule: the ref is still a plain name under `assets/`, still refused if it climbs out, and the
 * cache is only consulted for the name that survived the check. What it buys is a model too big
 * to travel — `moduleAssets.md` argues a module carries its material so it survives a fork, and
 * that argument inverts past a few hundred megabytes, where `forkSharedModule`'s recursive copy
 * would duplicate the file per fork, per médiathèque upload and per machine synced to.
 */
export function resolveModuleAsset(
  ref: unknown,
  folderAbs: string | undefined,
): string | undefined {
  if (typeof ref !== "string" || !ref || isAbsolute(ref)) return undefined;
  if (folderAbs) {
    const root = resolve(folderAbs, MODULE_ASSETS_DIR);
    const abs = resolve(root, ref);
    const inside = abs === root || abs.startsWith(root + sep);
    if (!inside) return undefined; // an escaping ref is refused, never redirected to the cache
    if (existsSync(abs)) return abs;
  }
  const cacheRoot = modelsRoot();
  const cached = resolve(cacheRoot, ref);
  const inCache = cached === cacheRoot || cached.startsWith(cacheRoot + sep);
  return inCache && existsSync(cached) ? cached : undefined;
}

/**
 * The file-valued params a module names, resolved absolute, plus `assets` keeping what was
 * AUTHORED for validate() to report against.
 *
 * They are read out of `params:`, because that is what they are: a .nam model is one of the
 * plugin's controls, sitting in the panel beside Input and Output. Its own top-level field made
 * it a second kind of thing to find, edit and merge — and `params` merges per key, so an
 * instance overriding just the model is now the same edit as overriding a gain.
 *
 * Everything resolves inside the module's OWN folder. A module that carries its amp profile is
 * self-contained: it travels through a fork, an upload to the médiathèque and a sync onto
 * another machine with its sound intact, the way its `.vstpreset` and its jsdsp source already
 * do. There is no shared library to fall through to any more.
 */
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

/**
 * The files a module carries, as `assets/`-relative POSIX paths — what its file-valued params
 * may be set to, and what the panel's dropdown offers.
 *
 * Walked RECURSIVELY and kept nested, because that is how these arrive: a NAM pack is a folder
 * per amp. Flattening a hundred models into one list is what made the old library picker
 * unusable. Depth-capped and symlink-blind (readdirSync does not follow them for isDirectory),
 * so a pathological tree cannot hang a UI request.
 */
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

// Read an external `modules_from` tree — only the GENERIC module.yaml, since instances aren't `extends` targets.
function readModuleTree(
  dir: string,
  root: string,
  key: (type: string, name: string) => string,
  out: Record<string, LoadedModule>,
  // Where a module file that would not READ is reported. A library's modules used to be
  // dropped in silence here, and the shape of that failure is the problem: the ref simply
  // stops existing, so every symptom downstream describes something else — "extends unknown
  // module" about a file sitting right there, a catalogue three rows short, a module that
  // stopped making a sound. The file's own complaint is the answer to all three.
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
        // Named by its REF, not by a path: the file is outside the project, so a
        // project-relative path would point at nothing, and the ref is what a chain says.
        file: `${key(type, sub)}/${basename(file.path)}`,
        line: 1,
        col: 1,
        severity: "warning",
        // Phrased to read on its own AND inside a sentence, since the ref check quotes it
        // ("extends 'x', which did not load — …").
        message: `did not load — ${read.issues.join("; ")}`,
      });
    const m = read.value;
    if (!m) return;
    // Seam cast: the value passed the module schema, so it fits LoadedModule's authored half.
    const decorate = (
      value: Record<string, unknown>,
      instance?: string,
    ): LoadedModule =>
      ({
        ...value,
        // A rack module's audio lives in this module's own folder.
        rack: value.rack
          ? resolveRackAudio(value.rack as RawRack, folder)
          : undefined,
        kind: meta.kind,
        ...portsOf(value, meta),
        // The type FOLDER and the module's own folder, as loadModules records them — what
        // says whether a midi-input module gives back audio or midi (see graph's toModule).
        category: type,
        file: leaf,
        instance,
        // A .vstpreset in the module's folder is its default state; an instance's own wins.
        preset: [
          join(folder, `${instance ?? leaf}.vstpreset`),
          join(folder, `${leaf}.vstpreset`),
        ].find(existsSync),
        // …and its DSP source, resolved against ITS OWN folder — unlike an asset, which follows the opened song.
        // A shared module carries its source the way it carries its preset: the folder is the module.
        jsdsp: jsDspFileFor(value, folder),
        // …and the files its params name, out of its OWN assets/ — a borrowed module brings its own.
        ...resolveAssets(value, folder),
      }) as LoadedModule;

    out[key(type, sub)] = decorate(m);
    // The instances beside module.yaml, keyed like a local one ("IN:in-1") under the ref.
    // Without these an inherited instance is unnameable: `module populate` files one io/IN
    // per interface input, and a chain has to be able to say WHICH input it takes.
    for (const { instance, file: ifile } of instanceFiles(
      folder,
      `${relDir}/${leaf}`,
    )) {
      const value = readModuleFile(ifile).value;
      if (!value || typeof value !== "object") continue;
      const merged = mergeAuthored(m, value);
      merged.ui = value.ui ?? m.ui; // a grid is taken whole, never half-merged (see loadModules)
      out[moduleKey(key(type, sub), instance)] = decorate(merged, instance);
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

// Load a project's modules into a { name: module } map, generic + instances both keyed in (see docs/loader.md).
export function loadModules(
  dir: string,
  validate = false, // off by default — see docs/loader.md ("loadModules internals")
): Record<string, LoadedModule> {
  const out: Record<string, LoadedModule> = {};
  const raw: { rel: string; module: Record<string, unknown> }[] = []; // AS AUTHORED, for validatePlugins below
  const yamlIssues: string[] = []; // held rather than thrown at once, so a load reports every bad file
  const bdir = join(dir, "modules");
  for (const [type, meta] of Object.entries(MODULE_TYPES)) {
    const abs = join(bdir, type);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs)) {
      const folder = join(abs, name);
      if (!statSync(folder).isDirectory()) continue;
      const relDir = `modules/${type}/${name}`;
      // A module folder is its `module.yaml` and nothing else now. Uses of a module are
      // files in the project's flat `instances/` — see the pass below and docs/instances.md.
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
      // Adds the LOADER's fields to the generic or a merged instance (see docs/loader.md).
      const decorate = (
        value: Record<string, unknown>,
        instance?: string,
      ): LoadedModule => {
        // Own preset wins, else the generic's — so a UI edit on one instance never touches a sibling's.
        const own = join(folder, `${instance ?? name}.vstpreset`);
        const generic = join(folder, `${name}.vstpreset`);
        const preset = existsSync(own)
          ? own
          : existsSync(generic)
            ? generic
            : undefined;
        // Seam cast: `value` passed the module schema (or a merge of two structs that did).
        return {
          ...value,
          name: moduleKey(name, instance), // the FOLDER (+ file) names it — not a field
          rack: value.rack // resolved on this copy, not `raw`, so validation sees the authored filename
            ? resolveRackAudio(value.rack as RawRack, folder)
            : undefined,
          category: type, // the module's type folder (io|instruments|audio|transformers|midi)
          file: name, // the module's folder name (modules/<category>/<file>/)
          instance, // undefined for the generic; the <instance>.yaml basename otherwise
          kind: meta.kind, // derived from the type folder, like a base module others `extends`
          ...portsOf(value, meta),
          preset,
          // The module's own DSP source, resolved against its FOLDER — see jsDspFileFor.
          jsdsp: jsDspFileFor(value, folder),
          // Resolved on this copy, same reason as `rack` above; `folder` is what makes its own assets reachable.
          ...resolveAssets(value, folder),
        } as LoadedModule;
      };

      if (module) out[name] = decorate(module);
    }
  }
  loadInstances(dir, out, raw, yamlIssues);
  if (validate) {
    if (yamlIssues.length)
      // callers already treat "invalid module(s)" as fatal and show it
      throw new Error(`invalid module(s):\n  ${yamlIssues.join("\n  ")}`);
    validatePlugins(raw);
  }
  applyUiLibrary(dir, out, (m) => moduleOwnRefs(m));
  return out;
}

/** The project's uses of modules: `instances/<name>.yaml`, flat, filename IS the name. */
export const INSTANCES_DIR = "instances";

/**
 * Load `instances/` into `out`, keyed by the bare filename — the name a chain writes.
 *
 * FLAT, and that is the point: an instance no longer mirrors the tree of what it uses, so a
 * project's uses are one folder you can read at a glance instead of leaves scattered under
 * `modules/<type>/<name>/`. The file is a module file — the same schema as `module.yaml`,
 * which is what lets an instance be self-contained.
 *
 * The loader deliberately does NOT decorate these with `category`, `kind` or `inputs`. A flat
 * folder has no type folder to read them off, so they arrive from whatever the instance
 * `extends`, through resolveModule — leaving them absent here is what lets that inheritance
 * happen (see moduleResolve's OWN_ONLY). An instance that extends nothing has no ports, and
 * `validate` is what says so.
 *
 * `preset`, `jsdsp` and `assets/` resolve against `instances/` itself: what belongs to a use
 * of a module sits beside that use.
 */
function loadInstances(
  dir: string,
  out: Record<string, LoadedModule>,
  raw: { rel: string; module: Record<string, unknown> }[],
  yamlIssues: string[],
): void {
  const folder = join(dir, INSTANCES_DIR);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return;
  for (const { id: instance, file } of entityFiles(folder, INSTANCES_DIR)) {
    const read = readModuleFile(file);
    yamlIssues.push(...read.issues);
    const value = read.value;
    if (!value || typeof value !== "object") continue;
    // A module folder and an instance file cannot both answer to one name: a chain naming it
    // would be ambiguous, and silently letting one win is how a project plays the wrong thing.
    if (instance in out) {
      yamlIssues.push(
        `${file.rel}: '${instance}' is already a module in this project — an instance cannot take its name`,
      );
      continue;
    }
    raw.push({ rel: file.rel, module: value });
    const preset = join(folder, `${instance}.vstpreset`);
    out[instance] = {
      ...value,
      // The FILE names it, exactly as it does for a track or a clip — never a `name:` field.
      name: instance,
      instance,
      file: instance,
      home: INSTANCES_DIR, // where its .vstpreset is saved — see nodeProject's presetSave
      rack: value.rack
        ? resolveRackAudio(value.rack as RawRack, folder)
        : undefined,
      ...(existsSync(preset) ? { preset } : {}),
      jsdsp: jsDspFileFor(value, folder),
      ...resolveAssets(value, folder),
    } as LoadedModule;
  }
}

/**
 * The refs a local module's OWN FILES may be filed under, best first.
 *
 * Its own — a module this project wrote has its own face. Then the module it DERIVES
 * from: a folder of instances is one use of something the engine or the library provides,
 * and a panel is drawn for the thing, not for each use of it. Without the fallback, moving
 * a project off the generated catalogue orphaned every panel that had been drawn for a
 * shared module — the same "No Options over a panel that is right there" as before, one
 * level further out.
 *
 * Exported because WRITING one of those files has to land where reading looks: `module cc`
 * resolves a chain's module name to a folder through exactly this list (see controller.ts).
 */
export function moduleOwnRefs(m: LoadedModule): string[] {
  const from = typeof m.extends === "string" ? m.extends : "";
  // A project's own module answers to two refs — bare and "@project/…" — and an instance may
  // have been written with either. Both are tried, so a panel drawn once is found either way.
  const spellings = from
    ? from.startsWith("@project/")
      ? [from, from.slice("@project/".length)]
      : [from, `@project/${from}`]
    : [];
  // An instance has no type folder, so it has no ref of its own to be filed under: its panel
  // is the panel of what it uses. Without this it asked for "undefined/<name>" and got nothing.
  if (!m.category)
    return spellings.length ? spellings : [engineRef(String(m.file))];
  const own = moduleRefOf(String(m.category), String(m.file));
  return spellings.length
    ? [own, ...spellings]
    : [own, engineRef(String(m.file))];
}

/**
 * Overlay the panels found beside the modules onto a module map, by ref.
 *
 * Applied at the SOURCE — here and in readModuleTree — so every consumer (the graph, the engine doc, hints,
 * the web) sees the panel without knowing the library exists. A panel replaces the module's own `ui:` whole,
 * for the same reason an inherited grid does: half of one author's layout inside another's is a grid nobody
 * drew.
 *
 * Instances share their generic's ref, so a panel drawn once shows on every instance — which is what the
 * generic-wins rule already said, back when panels lived in the module file.
 */
function applyUiLibrary(
  dir: string,
  out: Record<string, LoadedModule>,
  // One ref, or several to try in order — a module may answer to its own and to the one it
  // is a use of. First hit wins, so the specific beats the general.
  refOf: (m: LoadedModule, key: string) => string | string[],
): void {
  applyByRef(out, refOf, loadUiLibrary(dir).byRef, "ui", (e) => e.ui);
  applyByRef(out, refOf, loadControllerLibrary(dir).byRef, "cc", (e) => e.cc);
}

/** Stamp a folder-keyed sibling file onto every module that answers to its ref. The panel and the
 *  MIDI map are found the same way and land the same way; only the field differs. */
function applyByRef<E>(
  out: Record<string, LoadedModule>,
  refOf: (m: LoadedModule, key: string) => string | string[],
  byRef: Record<string, E>,
  field: string,
  valueOf: (entry: E) => unknown,
): void {
  const entries = Object.entries(out);
  if (!entries.length || !Object.keys(byRef).length) return;
  for (const [key, m] of entries) {
    const refs = refOf(m, key);
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const hit = byRef[ref];
      if (hit) {
        (m as unknown as Record<string, unknown>)[field] = valueOf(hit);
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

/**
 * The modules of the libraries this project inherits that would not READ.
 *
 * A library module that fails its schema is dropped from the ref map — it has to be, the
 * value is null — and until now that was the end of it. Nothing said so anywhere, and the
 * failure wears three different disguises depending on who asks next: the compiler reports
 * "extends unknown module" about a file that is plainly on disk, the builder's catalogue is
 * quietly short a row, and a song that played yesterday loses a sound. Two real bugs hid
 * behind exactly that silence, in the same afternoon.
 *
 * A WARNING and not an error: a library holds modules this project may never name, and one
 * of them being unreadable is not this project's failure to compile. It becomes an error the
 * moment something references it — see nodeProject's ref check, which reads these to say
 * "failed to load" rather than "unknown".
 */
export function libraryModuleIssues(dir: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  loadModuleRefs(dir, undefined, issues);
  return issues;
}

/**
 * Fields a project still declares that nothing reads any more.
 *
 * `modules_from` and `libraries_from` listed the shared folders; those are found by location
 * now, and the list could only ever have named the same two places. The schema still ACCEPTS
 * them — every song already written carries them, and refusing the key would turn a working
 * project into one that will not open — so this is what stops "accepted" from meaning
 * "silently ignored", which is the failure mode this codebase keeps paying for.
 */
export function deadProjectFields(dir: string): Diagnostic[] {
  let project: Record<string, unknown> | undefined;
  try {
    project = loadProjectRoot(dir).project as Record<string, unknown>;
  } catch {
    return []; // an unreadable header is the compile's error, not this
  }
  // Project-RELATIVE, like every other Diagnostic: `rel` comes back rooted ("/project.yaml")
  // for a file at the top, and the editor matches these against its own tree paths.
  const file = (
    entityFileFor(dir, "", "project")?.rel ?? "project.yaml"
  ).replace(/^\/+/, "");
  return (["modules_from", "libraries_from"] as const)
    .filter((k) => project?.[k] !== undefined)
    .map((k) => ({
      file,
      line: 1,
      col: 1,
      severity: "warning" as const,
      message: `\`${k}\` is no longer read — the shared folders are found where they sit (../_modules, ../_library, the médiathèque). This line can be deleted.`,
    }));
}

export function notSupportedModules(dir: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!existsSync(join(dir, "modules"))) return out;
  const modules = loadModules(dir); // authored, no validate
  for (const [name, m] of Object.entries(modules)) {
    const p = m?.plugin;
    if (!p || typeof p !== "object") continue;
    if (String(p.type ?? "").toLowerCase() !== "not_supported") continue;
    out.push({
      file: `modules/${m.category}/${m.file}/${m.instance ?? "module"}.yaml`, // the entry's OWN file, not the generic's
      line: 1,
      col: 1,
      severity: "warning",
      message: `plugin "${p.name ?? name}" is not supported — it will be bypassed`,
    });
  }
  return out;
}

// Load a project's tracks into a { id: track } map — tracks/<id>.yaml, id == filename.
export function loadTracks(
  dir: string,
  validate = false,
): Record<string, RawTrack> {
  return loadEntities<RawTrack>(dir, "tracks", "track", validate);
}

// Video tracks, same flat-per-file layout as tracks (video_tracks/<id>.yaml).
export function loadVideoTracks(
  dir: string,
  validate = false,
): Record<string, RawVideoTrack> {
  return loadEntities<RawVideoTrack>(
    dir,
    "video_tracks",
    "video track",
    validate,
  );
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

// Read one entity file — a track validates here; other kinds are left for the loaders downstream to reject.
function readEntityFile(
  file: { path: string; rel: string },
  sub: string,
  issues: string[],
): unknown {
  const text = readFileSync(file.path, "utf8");
  if (sub === "tracks") {
    const { value, issues: found } = parseTrack(text);
    issues.push(...found.map((i) => formatIssue(file.rel, i)));
    return value;
  }
  return parseYaml(text, { version: "1.2" });
}

// Shared reader for tracks / video_tracks (identical flat-per-file layout).
function loadEntities<T>(
  dir: string,
  sub: string,
  label: string,
  validate: boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  const yamlIssues: string[] = [];
  const edir = join(dir, sub);
  if (!existsSync(edir)) return out;
  for (const { id, file } of entityFiles(edir, sub)) {
    const value = readEntityFile(file, sub, yamlIssues);
    if (!value || typeof value !== "object") continue;
    out[id] = value as T; // seam cast — tracks passed their schema above; other kinds validate downstream
  }
  if (validate) {
    if (yamlIssues.length)
      throw new Error(`invalid ${label}(s):\n  ${yamlIssues.join("\n  ")}`);
  }
  return out;
}

/**
 * The project's ROOT — `project`, `trackOrder`, `markers` — from `project.yaml`.
 * `chains` is read separately (see loadChains).
 */
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

/**
 * The project's routing segments, from `chains.yaml` when it exists, else from
 * `root.chains` (a project may inline them in project.yaml). The chains themselves are
 * derived from this — see chainsGraph.ts.
 */
export function loadChains(
  dir: string,
  root: RawProjectRoot,
  validate = false,
): unknown {
  const file = entityFileFor(dir, "", "chains");
  if (!file) return root?.chains;
  const { value, issues } = parseChainsYaml(readFileSync(file.path, "utf8"));
  if (issues.length && validate)
    throw new Error(
      `invalid chains:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return value;
}

/**
 * The set's songs, from `songs.yaml` — the médiathèque refs an m9 project draws on,
 * deduplicated and sorted. Empty for a project that has no such file, which is every l8
 * song: the file is m9's, and its absence is not a fault.
 *
 * The refs are NOT resolved here. What a ref names lives in the médiathèque, whose catalogue
 * this package cannot read and should not learn to — and a ref that resolves to nothing is
 * exactly the one worth reporting, so resolution belongs where the catalogue is (the cache
 * sync fetches it, the surface says it is missing). Same reasoning as mediatekRefs.ts.
 */
export function loadSongs(dir: string, validate = false): string[] {
  const file = entityFileFor(dir, "", "songs");
  if (!file) return [];
  const { value, issues } = parseSongsYaml(readFileSync(file.path, "utf8"));
  if (issues.length && validate)
    throw new Error(
      `invalid songs:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return songRefs(value);
}

/**
 * The Mix desk's bindings, from `views/mix.yaml` — which panel control drives which module
 * param. Empty for a project that has no such file, which is every l8 song and every set that
 * has not bound anything.
 *
 * The control ids are NOT checked here, for the reason the schema states: they are the app's
 * vocabulary, not the format's. What IS checked is the shape, so a malformed file is a
 * reported error rather than a binding that silently does nothing.
 */
export function loadMixView(dir: string, validate = false): MixView {
  const file = entityFileFor(join(dir, VIEWS_DIR), "", MIX_VIEW_BASE);
  if (!file) return {};
  const { value, issues } = parseMixView(readFileSync(file.path, "utf8"));
  if (issues.length && validate)
    throw new Error(
      `invalid ${VIEWS_DIR}/${MIX_VIEW_BASE}:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return value ?? {};
}

/**
 * The DSP source of a module, or undefined when it has none.
 *
 * The PLUGIN TYPE decides: `plugin.type: jsdsp` means the sound comes from `jsdsp.ts` in this
 * module's own folder. It used to be a `jsdsp:` field naming the file, beside a
 * `plugin: {type: internal, name: DSP Graph}` that said nothing about it — two things to keep
 * in step, and the interesting one was the one nobody read. One statement now says both, and a
 * module with the type but no file is a module whose source is missing rather than one that
 * silently loads a graph host with nothing in it.
 */
function jsDspFileFor(
  value: Record<string, unknown>,
  folder: string,
): string | undefined {
  const plugin = value.plugin as { type?: unknown } | undefined;
  return String(plugin?.type ?? "") === JSDSP_TYPE
    ? join(folder, JSDSP_FILE)
    : undefined;
}

// Every module referenceable by REF — keyed "type/name", "@namespace/type/name", or a bare io name.
export function loadModuleRefs(
  dir: string,
  // The ENGINE's own modules — injected so a test can ask for a project's vocabulary and
  // nothing else. It is AMBIENT state: what this machine's engine offers, read from its
  // scan cache. The same reason ioPorts takes its preferences rather than loading them.
  catalogue: Record<string, LoadedModule> = engineModules(),
  // Where a library module that would not read is reported — see readModuleTree and
  // libraryModuleIssues. Optional because almost every caller wants the vocabulary and
  // nothing else; the ones that REPORT pass an array.
  issues: Diagnostic[] = [],
): Record<string, LoadedModule> {
  // The catalogue first, so anything on disk overrides it: a project or a library may
  // define `@engine/x`, and the thing you can edit should win over the thing you cannot.
  const out: Record<string, LoadedModule> = { ...catalogue };

  // Re-key by ref; INSTANCES are skipped, since one would silently replace its own generic's key.
  //
  // TWO keys for one module, and the second is the point: a project's own modules were named bare
  // (`audio/reverb`) before the levels were spelled out, and every chains.yaml already written says
  // them that way. `@project/audio/reverb` is the same module under its explicit level — the form
  // new files are written in — so both resolve and nothing had to be migrated.
  for (const m of Object.values(loadModules(dir))) {
    if (m.instance) continue;
    const ref =
      m.category === "io" ? String(m.file) : `${m.category}/${m.file}`;
    out[ref] = m;
    out[`@project/${ref}`] = m;
  }

  // The shared roots, found by location — the workspace's `_modules` beside the project, then
  // the médiathèque. Neither is declared, and neither can fail: a folder that is not there is
  // simply not a root, where a declaration naming it used to take the whole project down.
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

  // Panels come from the `ui.yaml` beside each module, keyed by these very refs — so a shared module drawn once
  // is drawn for every project that inherits it. loadModules already overlaid the local half; this catches the
  // inherited ones, and re-overlaying the locals is a no-op.
  //
  // Minus the INSTANCE: a panel is drawn for a module, and an instance is one use of it. This map keys an
  // inherited instance as "@engine/io/IN:in-2", which no panel answers to — so `IN`'s grid never reached the
  // twenty inputs `module populate` files, and every one of them drew "No Options". A local instance never had
  // the problem, because loadModules keys those by FOLDER, which a generic and its instances already share.
  applyUiLibrary(dir, out, (_m, ref) => splitModuleKey(ref).module);
  return out;
}

/** The ref map for a project — its own modules plus every shared root it inherits.
 *  A thin alias since the roots stopped being declared: there is nothing left to read off the
 *  header first, and nothing left that can throw. */
export const projectModules = (dir: string): Record<string, LoadedModule> =>
  loadModuleRefs(dir);

/**
 * The plugin refs a new module can `extends`, out of a ref map.
 *
 * io modules are usable directly but are not `extends` targets, and neither is an
 * INSTANCE — you extend a module, then instantiate. Two routes ask this: the picker's
 * own `/base-modules` (so a click does not pay for the whole of hints()) and the command
 * completions. They differ in what they already have loaded, never in the answer, which
 * is why the RULE lives here and not twice.
 */
export function baseModuleRefs(
  byRef: Record<string, { kind?: string; instance?: string }>,
): string[] {
  return Object.entries(byRef)
    .filter(([, m]) => m?.kind === "plugin" && !m?.instance)
    .map(([ref]) => ref)
    .sort();
}

/** …for a project, loading its own modules plus everything it inherits. */
export function listBaseModules(dir: string): string[] {
  return baseModuleRefs(projectModules(dir));
}

// The modules a chain step may name: the project's own by bare name, plus each SHARED
// module a step names by its ref ("@engine/audio/amp/nam"), resolved through `extends` so
// it arrives merged exactly like a local one and every consumer keyed on `step.module`
// finds it unchanged. Only refs the chains USE join the map — an inherited library you
// never name stays vocabulary (moduleRefs), not one of this project's modules.
export function withChainModuleRefs(
  modules: Record<string, LoadedModule>,
  byRef: Record<string, LoadedModule>,
  chains: Record<
    string,
    { use?: { module?: string }[]; out?: { to?: string }[] } | undefined
  >,
): Record<string, LoadedModule> {
  const out = { ...modules };
  // A chain's LAST node is its sink, parsed out of `use` into `out` — and isSink() looks
  // it up in this same map, so a ref has to arrive here from both or it works as a step
  // and not as an output.
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

// Create modules/<category>/<module>/module.yaml, optionally extending another; throws verbatim for the user.
// Create tracks/<id>.yaml — and, for a MIDI track, the empty sequence it plays.
//
// `track new` used to build a ProjectDoc in memory and hand it to the engine, which put a
// strip in the mixer and wrote NOTHING: the track was gone on the next reload, because a
// track IS its file. This is that file.
//
// Appends to `trackOrder` only when the project HAS one — buildDoc reads
// `trackOrder ?? Object.keys(tracksMap)` and then filters, so a project that orders its
// tracks explicitly would simply not show a track missing from the list, while one that
// doesn't order them needs no entry at all.
export function createTrackFile(
  dir: string,
  id: string,
  kind: "audio" | "midi",
): string[] {
  // The filename is the id, and the id is what a chain's `{track: …}` head names.
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid track name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `tracks/${id}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`track '${id}' already exists (${rel})`);

  const written: string[] = [];
  const put = (r: string, body: string) => {
    const path = join(dir, r);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
    written.push(r);
  };

  if (kind === "midi") {
    // Seeded with an empty 4-bar sequence: a MIDI track with no clip has nowhere to
    // record into, and the piano roll needs something to open.
    // Four empty bars, said as the sequence's own window: with no notes there is nothing to measure, and a
    // sequence with no extent draws as a clip of no width. The placement only says where it starts.
    put(
      `sequences/${id}.yaml`,
      `from: "1:1"
to: "5:1"
notes: []
`,
    );
    put(
      rel,
      `type: single
contentType: sequences
` +
        `mute: false
solo: false
` +
        `clips:
  - { ref: ${id}, start: "1:1:1" }
`,
    );
  } else {
    put(
      rel,
      `type: single
contentType: audio
` +
        `mute: false
solo: false
` +
        `clips: []
`,
    );
  }

  const root = loadProjectRoot(dir, true);
  if (Array.isArray(root.trackOrder)) {
    const projectFile = entityFileFor(dir, "", "project");
    if (projectFile)
      setFileValue(projectFile.path, ["trackOrder"], [...root.trackOrder, id]);
  }
  return written;
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

/**
 * Create one USE of a module: `instances/<instance>.yaml`.
 *
 * FLAT, whatever it is a use of. `category`/`module` say WHAT is being instantiated, not where
 * the file lands — an instance no longer mirrors the tree of the thing it uses, so the two are
 * now separate questions. A local module is named with `extends`; a module the engine provides
 * is inlined as `plugin:`, because the scan is a discovery aid and not the project's memory of
 * what it uses. Either way the file is a module file, so anything a `module.yaml` may say, an
 * instance may say too. See docs/instances.md.
 */
export function createModuleInstance(
  dir: string,
  category: string,
  module: string,
  instance: string,
  // Injected for the same reason loadModuleRefs takes it: what the engine offers is
  // AMBIENT, and a test asking "does this refuse an unknown name" must not depend on
  // what happens to be installed here.
  catalogue: Record<string, LoadedModule> = engineModules(),
): string {
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(instance))
    throw new Error(
      `invalid instance name '${instance}' — letters, digits, '_' and '-' only`,
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
  // The name is the KEY a chain writes, so it has to be free across the whole project, not
  // merely within a folder — a module already answering to it would be shadowed.
  if (instance in loadModules(dir))
    throw new Error(
      `'${instance}' already names a module or instance in this project`,
    );
  const rel = `${INSTANCES_DIR}/${instance}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  const plugin = fromEngine?.plugin;
  // The explicit level, which is the form new files are written in — see loadModuleRefs.
  const ref = `@project/${moduleRefOf(category, module)}`;
  const body = local
    ? `# ${instance}: one use of module "${category}/${module}".\n` +
      `# It inherits everything that module says — state only what THIS use changes, e.g.\n` +
      `#   params:\n` +
      `#     Filter Freq: 69\n` +
      `extends: ${JSON.stringify(ref)}\n`
    : `# ${instance}: one use of "${module}", a module the engine provides.\n` +
      `# The plugin is named here so the project says what it uses, whatever this machine\n` +
      `# has scanned. Add params: to set it.\n` +
      `plugin:\n` +
      `  type: ${JSON.stringify(String(plugin?.type ?? ""))}\n` +
      `  name: ${JSON.stringify(String(plugin?.name ?? ""))}\n`;
  mkdirSync(join(dir, INSTANCES_DIR), { recursive: true });
  writeFileSync(join(dir, rel), body, "utf8");
  return rel;
}

// Clone a module folder (instances, .vstpreset, rack audio) under a new name, rewriting `name:` if present.
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
