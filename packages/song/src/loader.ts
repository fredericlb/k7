// loader.ts — shared helpers for reading a YAML folder project: each subdirectory holds one flat file per
// entity, keyed by filename, and the root holds project/settings/chains. Read in-process and validated with
// Zod, which carries the file, line and column of a bad key into the diagnostics.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";
import { engineModules, engineRef } from "./engineCatalogue";
import { resolveMediatekRef } from "./mediatekRoot";
import { mergeAuthored, resolveModuleRef } from "./moduleResolve";
import {
  categoryForRole,
  INSTANCE_SEP,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
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
import { mediatekModulesRoot, moduleNamespaceOf } from "./sharedFolders";
import { loadUiLibrary } from "./uiLibrary";
import { parseChains as parseChainsYaml } from "./yaml/chainsFile";
import { setFileValue } from "./yaml/edit";
import { ENTITY_SCHEMAS } from "./yaml/entitySchemas";
import { formatIssue } from "./yaml/moduleFile";
import {
  entityFileFor,
  entityFiles,
  instanceFiles,
  moduleFileFor,
  readModuleFile,
} from "./yaml/moduleIO";
import { ProjectFileSchema, SettingsSchema } from "./yaml/projectSchema";
import { parseTrack } from "./yaml/trackFile";

// The module vocabulary lives in moduleTypes.ts (a leaf, no filesystem) so the engine
// catalogue can share it without importing this file. Re-exported here because this is
// where every consumer already looks for it.
export {
  categoryForRole,
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
  const at = (f: unknown) =>
    typeof f === "string" && f ? (isAbsolute(f) ? f : join(folderAbs, f)) : f;
  const symbols: NonNullable<RawRack["symbols"]> = {};
  for (const [sym, e] of Object.entries(rack.symbols ?? {}))
    symbols[sym] = e && typeof e === "object" ? { ...e, clip: at(e.clip) } : e;
  return { ...rack, source: at(rack.source), symbols };
}

// --- the asset library (see docs/loader.md) -------------------------------------

// The module fields naming a library file: the FIELD is the kind, its folder, and the command that sets it.
export const ASSET_FIELDS = ["ir", "nam"] as const;
export type AssetField = (typeof ASSET_FIELDS)[number];

/** What each library folder is allowed to hold. Anything else there is not offered. */
const ASSET_EXT: Record<AssetField, string[]> = {
  ir: [".wav", ".aiff", ".aif", ".flac"],
  nam: [".nam"],
};
const ALL_ASSET_EXT = [...new Set(Object.values(ASSET_EXT).flat())];

// The project's library folders, absolute and in declaration order; a missing one is dropped, and validate() reports.
export function libraryDirs(dir: string): string[] {
  let from: string[] = [];
  try {
    from = loadProjectRoot(dir).project?.libraries_from ?? [];
  } catch {
    return []; // no project header / bad export — no library
  }
  return (
    from
      .filter((p) => typeof p === "string" && p)
      // `resolve` on both branches, absolute included: a root kept verbatim can be spelled with the other
      // separator, and resolveLibraryFile's containment check compares it against a resolved path as text.
      .map((p) =>
        resolve(
          resolveMediatekRef(p, "library") ??
            (isAbsolute(p) ? p : resolve(dir, p)),
        ),
      )
      .filter((abs) => existsSync(abs))
  );
}

// A module's `ir` as an absolute path kept INSIDE the library — a "../.." reference is refused, not resolved.
export function resolveLibraryFile(
  ir: unknown,
  libDirs: string[],
): string | undefined {
  if (typeof ir !== "string" || !ir) return undefined;
  if (isAbsolute(ir)) return existsSync(ir) ? ir : undefined;
  // First library that holds it wins — declaration order is precedence.
  for (const libDir of libDirs) {
    const abs = resolve(libDir, ir);
    const inside = abs === libDir || abs.startsWith(libDir + sep);
    if (inside && existsSync(abs)) return abs;
  }
  return undefined;
}

// Every asset a module names: `ir`/`nam` become absolute, and `assets` keeps what was AUTHORED, for validate().
export function resolveAssets(
  m: Record<string, unknown> | null | undefined,
  libDirs: string[],
): Pick<LoadedModule, "ir" | "nam" | "assets"> {
  const out: Record<string, string | undefined> = {};
  const assets: Record<string, string> = {};
  for (const field of ASSET_FIELDS) {
    const ref = m?.[field];
    out[field] = resolveLibraryFile(ref, libDirs);
    if (typeof ref === "string" && ref) assets[field] = ref;
  }
  return {
    ...out,
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}

/** The files in one of a library's folders ("ir"), as library-relative POSIX paths. */
export function listLibrary(dir: string, kind: string): string[] {
  const libs = libraryDirs(dir);
  if (!libs.length || !/^[A-Za-z0-9_-]+$/.test(kind)) return [];
  // De-duplicated by the library-relative name — two libraries offering the same name are one choice.
  const seen = new Set<string>();
  for (const lib of libs) for (const f of oneLibrary(lib, kind)) seen.add(f);
  return [...seen].sort();
}

// One library's files under `kind`, RECURSIVELY, as library-relative POSIX paths
// ("nam/Two-Rock/Clean.nam"). Nested because that is how these folders actually arrive: a
// NAM pack is a folder per amp, an IR pack a folder per cabinet then per mic. Flattening
// them into one list of 300 entries is what made the picker unusable.
//
// Depth-capped and symlink-blind (readdirSync does not follow them for isDirectory), so a
// pathological tree cannot hang a UI request.
function oneLibrary(lib: string, kind: string): string[] {
  const MAX_DEPTH = 6;
  const exts = ASSET_EXT[kind as AssetField] ?? ALL_ASSET_EXT;
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // no such folder, or unreadable — an empty list, not an error
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH)
          walk(join(abs, e.name), `${rel}/${e.name}`, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = e.name.slice(e.name.lastIndexOf(".")).toLowerCase();
      // A known kind offers only its own extensions; an unknown one offers every extension pistes can use.
      if (exts.includes(ext)) out.push(`${rel}/${e.name}`);
    }
  };
  walk(join(lib, kind), kind, 0);
  return out.sort();
}

/** The kinds a project's library holds ("ir", …) — its subfolders, sorted. */
export function listLibraryKinds(dir: string): string[] {
  const seen = new Set<string>();
  for (const lib of libraryDirs(dir)) {
    try {
      for (const e of readdirSync(lib, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith(".")) seen.add(e.name);
    } catch {
      /* unreadable library — the others still offer theirs */
    }
  }
  return [...seen].sort();
}

// Read an external `modules_from` tree — only the GENERIC module.yaml, since instances aren't `extends` targets.
function readModuleTree(
  dir: string,
  root: string,
  key: (type: string, name: string) => string,
  out: Record<string, LoadedModule>,
  libDirs: string[] = [], // the OPENED project's libraries, not `dir`'s (see loadModuleRefs)
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
    const m = readModuleFile(file).value;
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
        inputs: meta.inputs,
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
        jsdsp:
          typeof value.jsdsp === "string" && value.jsdsp.trim()
            ? join(folder, basename(String(value.jsdsp).trim()))
            : undefined,
        ...resolveAssets(value, libDirs), // resolved against the OPENED song's library, even for an inherited module — a borrowed cabinet finds ITS cabinets
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
  if (!existsSync(bdir)) return out;
  const libDirs = libraryDirs(dir);
  for (const [type, meta] of Object.entries(MODULE_TYPES)) {
    const abs = join(bdir, type);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs)) {
      const folder = join(abs, name);
      if (!statSync(folder).isDirectory()) continue;
      const relDir = `modules/${type}/${name}`;
      // A folder with NO module.yaml holds instances that stand alone. That is how a
      // project uses a module the engine provides: the folder names it, each file in it
      // is one use, and there is no local generic to write — `kind`, `inputs` and the
      // category come from the type folder above, and the instance carries the rest.
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
          inputs: meta.inputs,
          preset,
          // The module's own DSP source, resolved against its FOLDER — a bare filename by design, so a module
          // stays a self-contained directory you can copy, clone or share without rewriting a path inside it.
          jsdsp:
            typeof value.jsdsp === "string" && value.jsdsp.trim()
              ? join(folder, basename(String(value.jsdsp).trim()))
              : undefined,
          ...resolveAssets(value, libDirs), // resolved on this copy, same reason as `rack` above
        } as LoadedModule;
      };

      if (module) out[name] = decorate(module);

      // Instances beside module.yaml, merged under the generic (vetted AS AUTHORED first — see docs/loader.md).
      // With no generic there is nothing to merge under: the instance IS the module.
      for (const { instance, file } of instanceFiles(folder, relDir)) {
        const iread = readModuleFile(file);
        yamlIssues.push(...iread.issues);
        const value = iread.value;
        if (!value || typeof value !== "object") continue;
        raw.push({ rel: file.rel, module: value });
        const merged = module ? mergeAuthored(module, value) : value;
        // `ui` is taken WHOLE from the generic — an instance's `ui:` has no effect. When
        // there is no generic the panel comes from the folder's own `ui.yaml`.
        if (module) merged.ui = module.ui;
        out[moduleKey(name, instance)] = decorate(merged, instance);
      }
    }
  }
  if (validate) {
    if (yamlIssues.length)
      // callers already treat "invalid module(s)" as fatal and show it
      throw new Error(`invalid module(s):\n  ${yamlIssues.join("\n  ")}`);
    validatePlugins(raw);
  }
  applyUiLibrary(dir, out, (m) => localUiRefs(m));
  return out;
}

/**
 * The refs a local module's panel may be filed under, best first.
 *
 * Its own — a module this project wrote has its own face. Then the module it DERIVES
 * from: a folder of instances is one use of something the engine or the library provides,
 * and a panel is drawn for the thing, not for each use of it. Without the fallback, moving
 * a project off the generated catalogue orphaned every panel that had been drawn for a
 * shared module — the same "No Options over a panel that is right there" as before, one
 * level further out.
 */
function localUiRefs(m: LoadedModule): string[] {
  const own = moduleRefOf(String(m.category), String(m.file));
  const from = typeof m.extends === "string" ? m.extends : "";
  return from ? [own, from] : [own, engineRef(String(m.file))];
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
  const entries = Object.entries(out);
  if (!entries.length) return;
  const lib = loadUiLibrary(dir);
  if (!Object.keys(lib.byRef).length) return;
  for (const [key, m] of entries) {
    const refs = refOf(m, key);
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const panel = lib.byRef[ref];
      if (panel) {
        (m as { ui?: unknown }).ui = panel.ui;
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

// Every module referenceable by REF — keyed "type/name", "@namespace/type/name", or a bare io name.
export function loadModuleRefs(
  dir: string,
  modulesFrom: string[] = [],
  // The ENGINE's own modules — injected so a test can ask for a project's vocabulary and
  // nothing else. It is AMBIENT state: what this machine's engine offers, read from its
  // scan cache. The same reason ioPorts takes its preferences rather than loading them.
  catalogue: Record<string, LoadedModule> = engineModules(),
): Record<string, LoadedModule> {
  // The catalogue first, so anything on disk overrides it: a project or a library may
  // define `@engine/x`, and the thing you can edit should win over the thing you cannot.
  const out: Record<string, LoadedModule> = { ...catalogue };
  const libDirs = libraryDirs(dir);

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

  const roots: string[] = [];
  for (const p of modulesFrom) {
    const ext = resolve(
      resolveMediatekRef(p, "modules") ?? (isAbsolute(p) ? p : resolve(dir, p)),
    );
    if (!existsSync(ext))
      throw new Error(`modules_from '${p}': folder not found (${ext})`);
    if (!roots.includes(ext)) roots.push(ext);
  }
  // The machine's media library, declared or not — see mediatekModulesRoot. A project that
  // still names `@mediatek` resolved to this same folder above, so it is added only once.
  const media = mediatekModulesRoot();
  if (media && !roots.includes(media)) roots.push(media);

  for (const root of roots) {
    // The level comes from WHERE the root is, not from anything it declares — see moduleNamespaceOf.
    const ns = moduleNamespaceOf(root);
    readModuleTree(
      root,
      "",
      (type, name) => `@${ns}/${type}/${name}`,
      out,
      libDirs,
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

// The ref map for a project — a broken inherited folder falls back to local modules only.
export function projectModules(dir: string): Record<string, LoadedModule> {
  let from: string[] = [];
  try {
    const mf = loadProjectRoot(dir).project?.modules_from;
    if (Array.isArray(mf)) from = mf.map(String);
  } catch {
    /* no project header / bad export — local modules only */
  }
  try {
    return loadModuleRefs(dir, from);
  } catch {
    return loadModuleRefs(dir, []);
  }
}

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

// Create an INSTANCE, scaffolded empty — it inherits the module.yaml beside it automatically.
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
  // "module" is reserved — it would collide with the generic it inherits from.
  if (instance === "module")
    throw new Error(
      "'module' is reserved — the module file IS the generic every instance inherits",
    );
  const local = moduleFileFor(
    join(dir, "modules", category, module),
    `modules/${category}/${module}`,
    "module",
  );
  // With no local generic the folder names a module the ENGINE provides, and the instance
  // has to stand on its own — so it records WHICH plugin. Without that, a project opened on
  // a machine that has never scanned would not know what to load: the scan is a discovery
  // aid, not the project's memory of what it uses.
  const fromEngine = local ? undefined : catalogue[engineRef(module)];
  if (!local && !fromEngine)
    throw new Error(
      `module '${category}/${module}' is neither in this project nor one the engine offers — ` +
        `create it first, or name one of the engine's`,
    );
  const rel = `modules/${category}/${module}/${instance}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  const key = moduleKey(module, instance);
  const plugin = fromEngine?.plugin;
  const body = local
    ? `# ${key}: an instance of module "${category}/${module}".\n` +
      `# It inherits everything in module.yaml — state only what THIS instance changes, e.g.\n` +
      `#   params:\n` +
      `#     Filter Freq: 69\n`
    : `# ${key}: one use of "${module}", a module the engine provides.\n` +
      `# The plugin is named here so the project says what it uses, whatever this machine\n` +
      `# has scanned. Add params: to set it.\n` +
      `plugin:\n` +
      `  type: ${JSON.stringify(String(plugin?.type ?? ""))}\n` +
      `  name: ${JSON.stringify(String(plugin?.name ?? ""))}\n`;
  mkdirSync(join(dir, "modules", category, module), { recursive: true });
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
