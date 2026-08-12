// moduleIO.ts — locate and read the YAML files a project is made of: module files
// (module.yaml + its <node>.yaml siblings), per-file entities (tracks/, clips/, …),
// and root files (project.yaml, chains.yaml, settings.yaml). Validation is Zod,
// in-process, with the line and column of the offending key.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { formatIssue, type ModuleIssue, parseModule } from "./moduleFile";

export interface ModuleFile {
  /** Absolute path to the file that exists. */
  path: string;
  /** Its path relative to the project — what an error message names. */
  rel: string;
}

// `.yml` as well as `.yaml`: same format, other spelling, and a person who types the
// short one should not find their module silently absent. `.yaml` wins when both exist.
const EXTS = [".yaml", ".yml"];

/** The basenames a module folder holds that are NEITHER the generic nor one of its nodes: its panel
 *  (uiLibrary.ts), its named settings (presets.ts) and its MIDI map (controller.ts). Named here because this
 *  file is what decides which of a folder's YAML files is what — and every one of them that is not on this list
 *  is one use of the module. Adding a sibling file without adding it here files it as a NODE. */
export const UI_BASE = "ui";
export const PRESETS_BASE = "presets";
export const CONTROLLER_BASE = "controller";

/** Every basename that is the module ITSELF rather than a use of it. */
export const MODULE_OWN_BASES: ReadonlySet<string> = new Set([
  "module",
  UI_BASE,
  PRESETS_BASE,
  CONTROLLER_BASE,
]);

/**
 * The module file for `base` ("module", or a node's name) in `folder`, or null when
 * the folder has none. `relDir` is the folder's path relative to the project, for the rel.
 */
export function moduleFileFor(
  folder: string,
  relDir: string,
  base: string,
): ModuleFile | null {
  for (const ext of EXTS) {
    const path = join(folder, `${base}${ext}`);
    if (existsSync(path)) return { path, rel: `${relDir}/${base}${ext}` };
  }
  return null;
}

/**
 * The NODE files beside a module's generic — every `<node>.yaml` that is none of the folder's own
 * (MODULE_OWN_BASES). One entry per node NAME; a directory is never one.
 */
export function nodeFiles(
  folder: string,
  relDir: string,
): { node: string; file: ModuleFile }[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return []; // unreadable folder — the generic still loads
  }
  const bases = new Set<string>();
  for (const f of names) {
    const ext = extname(f).toLowerCase();
    if (!EXTS.includes(ext)) continue;
    const base = basename(f, ext);
    // The generic, the panel, the preset shelf and the MIDI map are the module ITSELF, not uses of it.
    if (MODULE_OWN_BASES.has(base)) continue;
    try {
      if (!statSync(join(folder, f)).isFile()) continue;
    } catch {
      continue;
    }
    bases.add(base);
  }
  const out: { node: string; file: ModuleFile }[] = [];
  for (const base of [...bases].sort()) {
    const file = moduleFileFor(folder, relDir, base);
    if (file) out.push({ node: base, file });
  }
  return out;
}

/**
 * The file for entity `base` in `folder` — for the flat per-file kinds (tracks/, clips/,
 * sequences/, video_tracks/) and for a root file like chains. Exported separately from
 * moduleFileFor only because the rel is built differently.
 */
export function entityFileFor(
  folder: string,
  relDir: string,
  base: string,
): ModuleFile | null {
  return moduleFileFor(folder, relDir, base);
}

/** Every entity id in `folder` — the ids ARE the filenames. */
export function entityFiles(
  folder: string,
  relDir: string,
): { id: string; file: ModuleFile }[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  const bases = new Set<string>();
  for (const f of names) {
    const ext = extname(f).toLowerCase();
    if (!EXTS.includes(ext)) continue;
    try {
      if (!statSync(join(folder, f)).isFile()) continue;
    } catch {
      continue;
    }
    bases.add(basename(f, ext));
  }
  const out: { id: string; file: ModuleFile }[] = [];
  for (const base of [...bases].sort()) {
    const file = entityFileFor(folder, relDir, base);
    if (file) out.push({ id: base, file });
  }
  return out;
}

export interface ReadModule {
  /** The module as authored. Null when it could not be read. */
  value: Record<string, unknown> | null;
  /** Already-formatted problems (`<rel>:<line>: <path>: <message>`). */
  issues: string[];
}

/** Read one module file, validating it in process. */
export function readModuleFile(file: ModuleFile): ReadModule {
  const { value, issues } = parseModule(readFileSync(file.path, "utf8"));
  return {
    value: (value as Record<string, unknown> | null) ?? null,
    issues: issues.map((i: ModuleIssue) => formatIssue(file.rel, i)),
  };
}

/** Is `dir` a l8 project — does it hold a `project.yaml` (or `.yml`)? */
export function isProjectFolder(dir: string): boolean {
  try {
    return entityFileFor(dir, "", "project") !== null;
  } catch {
    return false;
  }
}
