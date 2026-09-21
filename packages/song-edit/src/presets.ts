// presets.ts — a module's named settings, in the `presets.yaml` beside its `module.yaml`. A preset IS its
// values: `<name>: { <param>: <number> }`, and the folder says which module. The other half of the engine's
// FACTORY discovery, which is the plugin's own and arrives over the wire. See docs/userPresets.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { moduleFolderForRef } from "@studio/song/controller";
import { loadModuleRefs } from "@studio/song/loader";
import { moduleFileFor, PRESETS_BASE } from "@studio/song/yaml/moduleIO";
import {
  type PresetsFile,
  PresetsFileSchema,
} from "@studio/song-schema/yaml/moduleSchema";
import { parse as parseYaml } from "yaml";
import { setModuleParam } from "./projectEdit";

// One preset, shaped to fold into the engine's list; index -1, since only program presets pick by index.
export interface UserPreset {
  name: string;
  source: "user";
  index: number;
  /** The preset's own name again — what `applyPresetToModule` takes. A preset has no path of its own. */
  path: string;
}

const VALID_NAME = /^[A-Za-z0-9 _-]+$/;

/** The `presets.yaml` for a module ref, or null — only a WORKSPACE plugin module has a folder to hold one. */
export function modulePresetsFile(
  dir: string,
  moduleRef: string,
): string | null {
  if (!moduleRef.startsWith("@workspace/")) return null;
  const refs = loadModuleRefs(dir) as Record<string, { kind?: string }>;
  if (refs[moduleRef]?.kind !== "plugin") return null;
  const folder = moduleFolderForRef(dir, moduleRef);
  return folder ? join(folder, `${PRESETS_BASE}.yaml`) : null;
}

/** Every preset the file declares; a file the schema refuses reads as EMPTY rather than throwing. */
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

/** Snapshot a module's authored params as a new named preset; a taken name throws, since overwriting is a decision. */
export function saveModuleAsPreset(
  dir: string,
  moduleRef: string,
  presetName: string,
): string {
  const name = presetName.trim();
  if (!VALID_NAME.test(name))
    throw new Error(
      `invalid preset name '${presetName}' — letters, digits, space, '_' and '-' only`,
    );
  // Keyed by the module's OWN ref — every node that extends it shares one shelf, a file in its folder.
  const refs = loadModuleRefs(dir) as Record<
    string,
    { params?: Record<string, unknown> }
  >;
  const m = refs[moduleRef];
  if (!m) throw new Error(`no module "${moduleRef}" in this workspace`);
  const path = modulePresetsFile(dir, moduleRef);
  if (!path)
    throw new Error(
      `module '${moduleRef}' can't hold presets — only a workspace plugin module can`,
    );

  const params = (m.params ?? {}) as Record<string, unknown>;
  const values = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "number"),
  ) as Record<string, number>;
  if (!Object.keys(values).length)
    throw new Error(
      `module '${moduleRef}' has no params to snapshot — set some params first`,
    );

  const existing = readPresets(path);
  if (existing[name])
    throw new Error(`preset '${name}' already exists — refusing to overwrite`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    presetsFileText(moduleRef, { ...existing, [name]: values }),
  );
  return relative(dir, path);
}

/** Apply a preset BY NAME, stamping its values onto the module. The caller reloads. */
export function applyPresetToModule(
  dir: string,
  moduleRef: string,
  presetName: string,
): void {
  const values = readPresets(modulePresetsFile(dir, moduleRef))[presetName];
  if (!values)
    throw new Error(`module '${moduleRef}' has no preset '${presetName}'`);
  // Through setModuleParam — one writer, one dispatch — straight onto the workspace module's own file.
  for (const [k, v] of Object.entries(values))
    setModuleParam(dir, moduleRef, k, v);
}

// A key as YAML, quoted only when it has to be — the same rule the panel writer applies, for the same reason.
const key = (k: string): string =>
  /^[A-Za-z0-9_][A-Za-z0-9 _.\-+]*$/.test(k) &&
  !/^(y|n|yes|no|on|off|true|false|null)$/i.test(k)
    ? k
    : JSON.stringify(k);

/** Serialise the shelf: one FLOW mapping per preset, so a preset reads as a row and adding one is a one-line diff. */
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
