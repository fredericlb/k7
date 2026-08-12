// presets.ts — a module's named settings, in the `presets.yaml` beside its `module.yaml`. A preset IS its
// values: `<name>: { <param>: <number> }`, and the folder says which module. The other half of the engine's
// FACTORY discovery, which is the plugin's own and arrives over the wire. See docs/userPresets.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadModules, MODULE_TYPES } from "@studio/song/loader";
import { parse as parseYaml } from "yaml";
import { setModuleParam } from "./projectEdit";
import { moduleFileFor, PRESETS_BASE } from "./yaml/moduleIO";
import { type PresetsFile, PresetsFileSchema } from "./yaml/moduleSchema";

// One preset, shaped to fold into the engine's list; index -1, since only program presets pick by index.
export interface UserPreset {
  name: string;
  source: "user";
  index: number;
  /** The preset's own name again — what `applyPresetToModule` takes. A preset has no path of its own now. */
  path: string;
}

const VALID_NAME = /^[A-Za-z0-9 _-]+$/;

/** The `presets.yaml` for a module ref, or null: only a module with a FOLDER can hold presets, which
 *  means a local plugin module. An inherited one is read where it lives; see docs/userPresets.md. */
export function modulePresetsFile(
  dir: string,
  moduleRef: string,
): string | null {
  if (!moduleRef || moduleRef.startsWith("@")) return null;
  const segs = moduleRef.split("/");
  if (segs.length !== 2) return null;
  const [type, name] = segs;
  if (!name || MODULE_TYPES[type]?.kind !== "plugin") return null;
  return join(dir, "modules", type, name, `${PRESETS_BASE}.yaml`);
}

/** Every preset the file declares, or an empty map. A file the schema refuses reads as EMPTY rather than
 *  throwing: one malformed shelf must not stop a module loading, exactly like a malformed panel. */
function readPresets(path: string | null): PresetsFile {
  if (!path) return {};
  const found = moduleFileFor(dirname(path), "", PRESETS_BASE);
  if (!found) return {};
  try {
    const raw = parseYaml(readFileSync(found.path, "utf8"), { version: "1.2" });
    const r = PresetsFileSchema.safeParse(raw ?? {});
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}

/** The presets a module offers, in file order. */
export function listModulePresets(
  dir: string,
  moduleRef: string,
): UserPreset[] {
  return Object.keys(readPresets(modulePresetsFile(dir, moduleRef))).map(
    (name) => ({ name, source: "user", index: -1, path: name }),
  );
}

/**
 * Snapshot a module's authored params as a new named preset.
 *
 * Throws verbatim on a bad name, a module that can't hold presets, an empty snapshot, or a name already taken —
 * overwriting is a decision, not a side effect of saving.
 */
export function saveModuleAsPreset(
  dir: string,
  module: string,
  presetName: string,
): string {
  const name = presetName.trim();
  if (!VALID_NAME.test(name))
    throw new Error(
      `invalid preset name '${presetName}' — letters, digits, space, '_' and '-' only`,
    );
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string; params?: Record<string, unknown> }
  >;
  const m = modules[module];
  if (!m) throw new Error(`no module "${module}" in this project`);
  // Keyed by the GENERIC's ref — every node shares one shelf, because the shelf is a file in the folder.
  const ref = m.category && m.file ? `${m.category}/${m.file}` : "";
  const path = modulePresetsFile(dir, ref);
  if (!path)
    throw new Error(
      `module '${module}' can't hold presets — only local plugin modules can`,
    );

  const params = (m.params ?? {}) as Record<string, unknown>;
  const values = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "number"),
  ) as Record<string, number>;
  if (!Object.keys(values).length)
    throw new Error(
      `module '${module}' has no params to snapshot — set some params first`,
    );

  const existing = readPresets(path);
  if (existing[name])
    throw new Error(`preset '${name}' already exists — refusing to overwrite`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, presetsFileText(ref, { ...existing, [name]: values }));
  return relative(dir, path);
}

/** Apply a preset BY NAME, stamping its values onto the module. The caller reloads. */
export function applyPresetToModule(
  dir: string,
  module: string,
  presetName: string,
): void {
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string }
  >;
  const m = modules[module];
  if (!m?.category || !m?.file)
    throw new Error(`no module "${module}" in this project`);
  const ref = `${m.category}/${m.file}`;
  const values = readPresets(modulePresetsFile(dir, ref))[presetName];
  if (!values)
    throw new Error(`module '${module}' has no preset '${presetName}'`);
  // Through setModuleParam — one writer, one dispatch — so a node takes it and leaves its generic alone.
  for (const [k, v] of Object.entries(values))
    setModuleParam(dir, module, k, v);
}

// A key as YAML, quoted only when it has to be — the same rule the panel writer applies, for the same reason.
const key = (k: string): string =>
  /^[A-Za-z0-9_][A-Za-z0-9 _.\-+]*$/.test(k) &&
  !/^(y|n|yes|no|on|off|true|false|null)$/i.test(k)
    ? k
    : JSON.stringify(k);

/**
 * Serialise the shelf: one FLOW mapping per preset, hand-written rather than through `stringify`.
 *
 * A preset is read as a row — a name and the handful of values it sets — and the block form turns six presets
 * into forty lines nobody scans. It also keeps adding one to a one-line diff. Same argument, same shape, as
 * the panel writer's widgets.
 */
function presetsFileText(ref: string, presets: PresetsFile): string {
  PresetsFileSchema.parse(presets);
  const lines = [`# presets for ${ref}`];
  for (const [name, values] of Object.entries(presets)) {
    const body = Object.entries(values)
      .map(([k, v]) => `${key(k)}: ${v}`)
      .join(", ");
    lines.push(`${key(name)}: { ${body} }`);
  }
  return `${lines.join("\n")}\n`;
}

/** Has this module a shelf at all — what a listing shows before opening it. */
export function hasPresets(dir: string, moduleRef: string): boolean {
  const path = modulePresetsFile(dir, moduleRef);
  return !!path && !!moduleFileFor(dirname(path), "", PRESETS_BASE);
}
