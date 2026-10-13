// presets.ts — a NODE's presets on disk: listed from every preset tree it can see, applied onto
// the node's own file, saved and updated from what the node resolves to. Keyed by the module the
// node `extends`, so every use of `@st0/instruments/synth` offers the same shelf, wherever kept.
// One thing a reader gets wrong: the scope is WHERE a preset lives, the path is WHICH module it
// is for — a workspace may keep presets for a library module. See packages/song/docs/userPresets.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { swappedModule } from "@studio/song/alternatives";
import { moduleBaseChoices } from "@studio/song/basePreset";
import { loadModuleRefs, loadModules } from "@studio/song/loader";
import {
  resolvedRack,
  resolvedType,
  resolveModule,
} from "@studio/song/moduleResolve";
import {
  accountLibraries,
  isLibraryRootEditable,
  libraryRoot,
} from "@studio/song/sharedFolders";
import { currentEngine, engineNames } from "@studio/song-schema/engines";
import { isLibraryName } from "@studio/song-schema/moduleTypes";
import {
  LIBRARY_PRESETS_DIR,
  type NodePresets,
  PRESET_NAME,
  PROJECT_SAMPLE_PREFIX,
  type PresetEntry,
  type PresetFile,
  PresetFileSchema,
  type PresetScope,
  presetFileText,
  presetModulePath,
  SHARED_PRESETS_DIR,
  WORKSPACE_SCOPE,
} from "@studio/song-schema/presets";
import {
  clearAlternativeParams,
  setAlternativeField,
  setAlternativeParam,
} from "@studio/song-schema/yaml/alternativeFile";
import { parse as parseYaml } from "yaml";
import { selectModuleEngine } from "./engineSwitch";
import { editModuleFile } from "./projectEdit";
import { setKit } from "./rackTaps";

/** The node as it PLAYS: the module its attribute set names, when the set on swaps it for another (docs/alternatives.md). */
function playedAs(dir: string, node: string) {
  const m = loadModules(dir)[node];
  if (!m) throw new Error(`no node named '${node}'`);
  return swappedModule(m) ?? m;
}

/** The module ref a node's presets are keyed by — what the node, as it plays, `extends` — or null for one with none. */
export function presetRefOf(dir: string, node: string): string | null {
  const m = playedAs(dir, node) as { extends?: unknown };
  const ref = typeof m.extends === "string" ? m.extends : "";
  return presetModulePath(ref) ? ref : null;
}

/** Every scope this project can keep a preset in: its workspace, then each library by name. */
export function presetScopes(dir?: string): PresetScope[] {
  return [WORKSPACE_SCOPE, ...accountLibraries(dir).map((l) => l.name)];
}

// The preset tree a scope keeps — `_presets/` beside the project, or a library's `presets/`.
function scopeRoot(dir: string, scope: PresetScope): string {
  if (scope === WORKSPACE_SCOPE) return resolve(dir, "..", SHARED_PRESETS_DIR);
  const lib = isLibraryName(scope)
    ? accountLibraries(dir).find((l) => l.name === scope)
    : undefined;
  if (!lib) throw new Error(`no library '${scope}' to keep presets in`);
  return join(lib.root, LIBRARY_PRESETS_DIR);
}

// The folder one module's presets sit in, inside a scope.
function presetFolder(dir: string, scope: PresetScope, ref: string): string {
  const rel = presetModulePath(ref);
  if (!rel)
    throw new Error(`'${ref}' is not a module ref presets can be kept for`);
  return join(scopeRoot(dir, scope), ...rel.split("/"));
}

/** The file a preset is, refused when the name would leave its module's folder. */
export function presetFile(
  dir: string,
  scope: PresetScope,
  ref: string,
  name: string,
): string {
  if (!PRESET_NAME.test(name))
    throw new Error(
      `invalid preset name '${name}' — letters, digits, space, '_' and '-' only`,
    );
  const folder = presetFolder(dir, scope, ref);
  const path = resolve(folder, `${name}.yaml`);
  if (!path.startsWith(folder + sep))
    throw new Error(`invalid preset name '${name}'`);
  return path;
}

/** What a node offers: its presets from every scope, workspace first, each scope by name. */
export function listNodePresets(dir: string, node: string): NodePresets {
  const scopes = presetScopes();
  const ref = presetRefOf(dir, node);
  if (!ref) return { ref: null, presets: [], scopes };
  const presets: PresetEntry[] = [];
  for (const scope of scopes) {
    const folder = presetFolder(dir, scope, ref);
    if (!existsSync(folder)) continue;
    const names = readdirSync(folder, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
      .map((e) => e.name.replace(/\.ya?ml$/, ""))
      .filter((n) => PRESET_NAME.test(n))
      .sort((a, b) => a.localeCompare(b));
    for (const name of names) presets.push({ scope, name });
  }
  return { ref, presets, scopes };
}

/** One preset's content; a file the schema refuses throws with the reason, since applying half of one would be worse. */
export function readPreset(
  dir: string,
  scope: PresetScope,
  ref: string,
  name: string,
): PresetFile {
  const path = presetFile(dir, scope, ref, name);
  const found = existsSync(path) ? path : path.replace(/\.yaml$/, ".yml");
  if (!existsSync(found))
    throw new Error(`no preset '${name}' in ${scope} for ${ref}`);
  const r = PresetFileSchema.safeParse(
    parseYaml(readFileSync(found, "utf8"), { version: "1.2" }) ?? {},
  );
  if (!r.success)
    throw new Error(
      `preset '${name}' is malformed: ${r.error.issues[0]?.message ?? "invalid"}`,
    );
  return r.data;
}

type Kit = NonNullable<PresetFile["rack"]>;

/** A rack node's kit as a preset keeps it — refused when a pad plays a sound only this project has. */
function kitSnapshot(node: string, rack: ReturnType<typeof resolvedRack>): Kit {
  if (rack.rackType === "slice")
    throw new Error(
      `'${node}' slices one source — only a kit of library samples can be kept as a preset`,
    );
  const kit: Kit = {};
  for (const [sym, tap] of Object.entries(rack.symbols)) {
    const sample = typeof tap.sample === "string" ? tap.sample : undefined;
    if (sample?.startsWith(PROJECT_SAMPLE_PREFIX))
      throw new Error(
        `pad '${sym}' plays ${sample}, a sample only this project has — move it into a library first`,
      );
    if (!sample && tap.clip)
      throw new Error(
        `pad '${sym}' plays a file of the module's own folder — give it a library sample first`,
      );
    kit[sym] = sample
      ? { note: Number(tap.note), sample }
      : { note: Number(tap.note) };
  }
  return kit;
}

// The base a node is on: its own `base:`, else the nearest one up what it extends — a module's default patch included.
function chosenBase(
  node: { base?: unknown; extends?: unknown } | undefined,
  refs: Readonly<Record<string, { base?: unknown; extends?: unknown }>>,
): string {
  let cur = node;
  for (let i = 0; cur && i < 16; i++) {
    if (typeof cur.base === "string" && cur.base.trim()) return cur.base.trim();
    cur = typeof cur.extends === "string" ? refs[cur.extends] : undefined;
  }
  return "";
}

/** What a node plays as right now: its resolved numeric params, the engine and base they belong to, and a rack's kit. */
export function nodeSnapshot(dir: string, node: string): PresetFile {
  const m = loadModules(dir)[node];
  if (!m) throw new Error(`no node named '${node}'`);
  const resolved = resolveModule(m, loadModuleRefs(dir));
  const params = Object.fromEntries(
    Object.entries(resolved.params ?? {}).filter(
      (e): e is [string, number] =>
        typeof e[1] === "number" && Number.isFinite(e[1]),
    ),
  );
  const engine =
    engineNames(resolved).length > 1 ? currentEngine(resolved) : undefined;
  const rack =
    resolvedType(resolved) === "rack"
      ? kitSnapshot(node, resolvedRack(resolved))
      : undefined;
  // The base the values were taken over: a Surge patch's routing and wavetables are not params, so they travel by name.
  const base = chosenBase(playedAs(dir, node), loadModuleRefs(dir));
  return {
    ...(engine ? { engine } : {}),
    ...(base ? { base } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...(rack && Object.keys(rack).length ? { rack } : {}),
  };
}

/** Write a node's state as a preset — `update` requires it to exist, a new one refuses a taken name. */
export function writeNodePreset(
  dir: string,
  node: string,
  scope: PresetScope,
  name: string,
  mode: "new" | "update",
): { path: string; ref: string; preset: PresetFile } {
  const ref = presetRefOf(dir, node);
  if (!ref)
    throw new Error(`'${node}' extends no module, so it has no presets`);
  if (
    scope !== WORKSPACE_SCOPE &&
    !isLibraryRootEditable({ name: scope, root: libraryRoot(scope, dir) })
  )
    throw new Error(
      `a preset is kept in '${scope}' by the origin's admins only — a library is theirs to edit`,
    );
  const path = presetFile(dir, scope, ref, name.trim());
  const exists = existsSync(path);
  if (mode === "new" && exists)
    throw new Error(
      `preset '${name}' already exists in ${scope} — update it instead`,
    );
  if (mode === "update" && !exists)
    throw new Error(`no preset '${name}' in ${scope} to update`);
  const preset = nodeSnapshot(dir, node);
  // A base alone is worth keeping: it is the whole sound of a patch (docs/userPresets.md).
  if (!preset.params && !preset.rack && !preset.base)
    throw new Error(
      `'${node}' has no params, base or pads to keep — set some first`,
    );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, presetFileText(ref, preset), "utf8");
  return { path, ref, preset };
}

/** Load a preset onto a node: its engine first, then its values in ONE write, then its kit in place of the node's. */
export function applyPresetToNode(
  dir: string,
  node: string,
  scope: PresetScope,
  name: string,
): {
  params: Record<string, number>;
  switched: boolean;
  rebased: boolean;
  kit: boolean;
  missingEngine?: string;
  missingBase?: string;
} {
  const ref = presetRefOf(dir, node);
  if (!ref)
    throw new Error(`'${node}' extends no module, so it has no presets`);
  const preset = readPreset(dir, scope, ref, name);
  const params = preset.params ?? {};
  const resolved = () =>
    resolveModule(loadModules(dir)[node], loadModuleRefs(dir));
  let switched = false;
  let missingEngine: string | undefined;
  // Checked before anything is written, so a kit the node cannot take leaves it untouched.
  if (preset.rack && resolvedType(resolved()) !== "rack")
    throw new Error(`preset '${name}' holds a kit and '${node}' is not a rack`);
  if (preset.engine) {
    const r = resolved();
    if (!engineNames(r).includes(preset.engine)) missingEngine = preset.engine;
    else if (currentEngine(r) !== preset.engine) {
      selectModuleEngine(dir, node, preset.engine);
      switched = true;
    }
  }
  // The base next, since the values are what goes on top of it — as the engine applies them (docs/userPresets.md).
  let rebased = false;
  let missingBase: string | undefined;
  if (preset.base) {
    const m = playedAs(dir, node);
    const current = chosenBase(m, loadModuleRefs(dir));
    if (!moduleBaseChoices(m, loadModuleRefs(dir)).includes(preset.base))
      missingBase = preset.base;
    else if (current !== preset.base) {
      // Into the set that is on, as the values go: a node whose set swaps its module reads its base there.
      const base = preset.base;
      editModuleFile(dir, node, (text) =>
        setAlternativeField(text, "base", base),
      );
      rebased = true;
    }
  }
  // The engine that is on AFTER the switch, since a module with engines keeps its knobs per engine.
  const engine = currentEngine(resolved());
  // A new base drops the node's own values: they were set over the old state and mean nothing over this one.
  if (rebased || Object.keys(params).length)
    editModuleFile(dir, node, (text) =>
      Object.entries(params).reduce(
        (t, [k, v]) => setAlternativeParam(t, k, v, engine),
        rebased ? clearAlternativeParams(text, engine) : text,
      ),
    );
  if (preset.rack) setKit(dir, node, preset.rack);
  return {
    params,
    switched,
    rebased,
    kit: !!preset.rack,
    ...(missingEngine ? { missingEngine } : {}),
    ...(missingBase ? { missingBase } : {}),
  };
}
