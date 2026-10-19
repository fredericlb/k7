// moduleIO.ts — locate and read the .k7x files a project is made of: module files
// (module.k7x + its <node>.k7x siblings), per-file entities (tracks/, clips/, …),
// and root files (project.k7x, graph.k7x, settings.k7x). Validation is Zod,
// in-process, with the line and column of the offending key.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  formatIssue,
  type ModuleIssue,
  parseModule,
  parseModuleData,
} from "@studio/song-schema/yaml/moduleFile";
import { K7X_EXT, wsExists } from "./workspaceFile";
import { settledParse } from "./yamlCache";

export interface ModuleFile {
  /** Absolute path to the file that exists. */
  path: string;
  /** Its path relative to the project — what an error message names. */
  rel: string;
}

/** The module folder's OWN basenames — anything else there is a node, so add a new sibling here. */
export const UI_BASE = "ui";
// A stale `presets.k7x` in a module folder stays RESERVED, never a node, and is read by nothing (docs/userPresets.md).
export const PRESETS_BASE = "presets";
export const CONTROLLER_BASE = "controller";

/** Every basename that is the module ITSELF rather than a use of it. */
export const MODULE_OWN_BASES: ReadonlySet<string> = new Set([
  "module",
  UI_BASE,
  PRESETS_BASE,
  CONTROLLER_BASE,
]);

/** The module file for `base` ("module", or a node's name) in `folder`, or null; `relDir` builds the rel. */
export function moduleFileFor(
  folder: string,
  relDir: string,
  base: string,
): ModuleFile | null {
  const path = join(folder, `${base}${K7X_EXT}`);
  return wsExists(path) ? { path, rel: `${relDir}/${base}${K7X_EXT}` } : null;
}

/** The .k7x files a folder holds, by basename, in ONE readdir — see docs/moduleCache.md. */
function docFilesIn(folder: string): Map<string, string> {
  let found: Dirent[];
  try {
    found = readdirSync(folder, { withFileTypes: true });
  } catch {
    return new Map(); // not there, or unreadable — every caller treats that as empty
  }
  const byBase = new Map<string, string>();
  for (const e of found) {
    const ext = extname(e.name).toLowerCase();
    if (ext !== K7X_EXT) continue;
    if (e.isDirectory()) continue;
    if (!e.isFile()) {
      // A symlink, or something stranger: ask what it points AT — a library reached through one must load.
      try {
        if (!statSync(join(folder, e.name)).isFile()) continue;
      } catch {
        continue;
      }
    }
    byBase.set(basename(e.name, extname(e.name)), e.name);
  }
  return byBase;
}

/** The NODE files beside a module's generic — every `<node>.k7x` that is not one of MODULE_OWN_BASES. */
export function nodeFiles(
  folder: string,
  relDir: string,
): { node: string; file: ModuleFile }[] {
  const out: { node: string; file: ModuleFile }[] = [];
  for (const [base, name] of [...docFilesIn(folder)].sort()) {
    // The generic, the panel, the preset shelf and the MIDI map are the module ITSELF, not uses of it.
    if (MODULE_OWN_BASES.has(base)) continue;
    out.push({
      node: base,
      file: { path: join(folder, name), rel: `${relDir}/${name}` },
    });
  }
  return out;
}

/** The file for entity `base` — the flat per-file kinds and the root files, `rel` built differently. */
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
  const out: { id: string; file: ModuleFile }[] = [];
  for (const [base, name] of [...docFilesIn(folder)].sort())
    out.push({
      id: base,
      file: { path: join(folder, name), rel: `${relDir}/${name}` },
    });
  return out;
}

export interface ReadModule {
  /** The module as authored. Null when it could not be read. */
  value: Record<string, unknown> | null;
  /** Already-formatted problems (`<rel>:<line>: <path>: <message>`). */
  issues: string[];
}

/** Read one module file, validating it in process; a settled file is not read again. */
export function readModuleFile(file: ModuleFile): ReadModule {
  const { value, issues } = settledParse(
    file.path,
    "module",
    parseModule,
    parseModuleData,
  );
  return {
    // Cloned: the loaders write `ui` and `cc` onto what they get, and the parse is shared.
    value: value ? structuredClone(value as Record<string, unknown>) : null,
    issues: issues.map((i: ModuleIssue) => formatIssue(file.rel, i)),
  };
}

/** Is `dir` a k7 project — does it hold a `project.k7x`? */
export function isProjectFolder(dir: string): boolean {
  try {
    return entityFileFor(dir, "", "project") !== null;
  } catch {
    return false;
  }
}
