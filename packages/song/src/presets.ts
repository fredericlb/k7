// presets.ts — user-authored, project-local presets for a module, the OTHER half of the engine's factory
// discovery: these live in the SONG, in the module's own `<name>.presets/` folder, so they travel with it.
// A snapshot is YAML params or an opaque .vstpreset blob. See docs/userPresets.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { loadModules, MODULE_TYPES } from "@studio/song/loader";
import { parse as parseYaml, stringify } from "yaml";
import { setModuleParam } from "./projectEdit";

// One user preset, shaped to fold into the engine's list; index -1, since only program presets pick by index.
export interface UserPreset {
  name: string;
  source: "user";
  index: number;
  path: string;
}

const VALID_NAME = /^[A-Za-z0-9 _-]+$/;

// The `.presets` folder for a module ref, or null: only LOCAL plugin modules can hold project-local presets.
export function modulePresetsDir(
  dir: string,
  moduleRef: string,
): string | null {
  if (!moduleRef || moduleRef.startsWith("@")) return null;
  const segs = moduleRef.split("/");
  if (segs.length !== 2) return null;
  const [type, name] = segs;
  if (!name || MODULE_TYPES[type]?.kind !== "plugin") return null;
  return join(dir, "modules", type, name, `${name}.presets`); // beside the module's own file
}

// The user presets a module offers — both formats listed, told apart by extension when applying.
export function listModulePresets(
  dir: string,
  moduleRef: string,
): UserPreset[] {
  const pdir = modulePresetsDir(dir, moduleRef);
  if (!pdir || !existsSync(pdir)) return [];
  const out: UserPreset[] = [];
  for (const file of readdirSync(pdir).sort()) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".yaml" && ext !== ".yml" && ext !== ".vstpreset") continue;
    out.push({
      name: basename(file, extname(file)),
      source: "user",
      index: -1,
      path: join(pdir, file),
    });
  }
  return out;
}

// Snapshot a module's persisted state into its preset library — a .vstpreset verbatim, else `params` as YAML.
// Throws verbatim on a bad name, an unsupported module, an empty snapshot, or a name taken.
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
    {
      category?: string;
      file?: string;
      params?: Record<string, unknown>;
      preset?: string;
    }
  >;
  const m = modules[module];
  if (!m) throw new Error(`no module "${module}" in this project`);
  const ref = m.category && m.file ? `${m.category}/${m.file}` : ""; // keyed by the GENERIC's ref — every instance shares one preset shelf
  const pdir = modulePresetsDir(dir, ref);
  if (!pdir)
    throw new Error(
      `module '${module}' can't hold presets — only local plugin modules can`,
    );

  const yamlPath = join(pdir, `${name}.yaml`);
  const vstPath = join(pdir, `${name}.vstpreset`);
  if (existsSync(yamlPath) || existsSync(vstPath))
    throw new Error(`preset '${name}' already exists — refusing to overwrite`);

  mkdirSync(pdir, { recursive: true });

  if (m.preset && existsSync(m.preset)) {
    // an opaque plugin's state is its .vstpreset — snapshot the blob
    copyFileSync(m.preset, vstPath);
    return relative(dir, vstPath);
  }

  const params = (m.params ?? {}) as Record<string, unknown>; // otherwise capture the module's authored params as YAML
  if (!Object.keys(params).length)
    throw new Error(
      `module '${module}' has no saved params or preset to snapshot — set some params first`,
    );
  // One field per line under `params:` — the shape a module file has by hand. No format
  // pass afterwards: `stringify` already emits canonical YAML.
  const body =
    `# ${name}: a preset for module "${ref}".\n` +
    stringify({ params }, { version: "1.2", lineWidth: 0 });
  writeFileSync(yamlPath, body, "utf8");
  return relative(dir, yamlPath);
}

// Apply a user preset: a .vstpreset is copied over, a params snapshot written field by field. The caller reloads.
export function applyPresetToModule(
  dir: string,
  module: string,
  presetPath: string,
): void {
  const modules = loadModules(dir) as Record<
    string,
    { category?: string; file?: string; instance?: string }
  >;
  const m = modules[module];
  if (!m?.category || !m?.file)
    throw new Error(`no module "${module}" in this project`);

  if (extname(presetPath).toLowerCase() === ".vstpreset") {
    if (!existsSync(presetPath))
      throw new Error(`preset not found: ${presetPath}`);
    // modules/<cat>/<name>/<name-or-instance>.vstpreset — applying to an instance leaves the generic alone.
    copyFileSync(
      presetPath,
      join(
        dir,
        "modules",
        m.category,
        m.file,
        `${m.instance ?? m.file}.vstpreset`,
      ),
    );
    return;
  }

  // A params snapshot — read it and stamp its numeric params onto the module.
  if (!existsSync(presetPath))
    throw new Error(`preset not found: ${presetPath}`);
  const preset = parseYaml(readFileSync(presetPath, "utf8"), {
    version: "1.2",
  }) as { params?: Record<string, unknown> } | null;
  const params = preset?.params ?? {};
  // Through setModuleParam — one writer, one dispatch.
  for (const [k, v] of Object.entries(params))
    if (typeof v === "number") setModuleParam(dir, module, k, v);
}
