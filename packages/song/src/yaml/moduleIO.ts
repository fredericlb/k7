// moduleIO.ts — locate and read the YAML files a project is made of: module files
// (module.yaml + its <node>.yaml siblings), per-file entities (tracks/, clips/, …),
// and root files (project.yaml, graph.yaml, settings.yaml). Validation is Zod,
// in-process, with the line and column of the offending key.

import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
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
 * The YAML files a folder holds, keyed by basename, `.yaml` winning over `.yml`.
 *
 * One `readdir` and nothing else. Listing a folder used to cost three syscalls per entry — the
 * readdir, a `statSync` to prove the entry was a file, then `existsSync` back through
 * `moduleFileFor` to find the name readdir had just handed over. On a real song that was 40% of
 * `entityFiles`, for facts already in hand: a `Dirent` says file-or-directory itself. Only a
 * SYMLINK still needs a stat — `Dirent` reports the link, `statSync` reports its target, and a
 * library module reached through one must keep loading.
 */
function yamlFilesIn(folder: string): Map<string, string> {
  let found: Dirent[];
  try {
    found = readdirSync(folder, { withFileTypes: true });
  } catch {
    return new Map(); // not there, or unreadable — every caller treats that as empty
  }
  const byBase = new Map<string, string>();
  for (const e of found) {
    const ext = extname(e.name).toLowerCase();
    if (!EXTS.includes(ext)) continue;
    if (e.isDirectory()) continue;
    if (!e.isFile()) {
      // A symlink, or something stranger: ask what it points AT, as the stat used to.
      try {
        if (!statSync(join(folder, e.name)).isFile()) continue;
      } catch {
        continue;
      }
    }
    const base = basename(e.name, ext);
    // `.yaml` wins when both spellings are there, whichever order readdir returned them in.
    if (ext === ".yaml" || !byBase.has(base)) byBase.set(base, e.name);
  }
  return byBase;
}

/**
 * The NODE files beside a module's generic — every `<node>.yaml` that is none of the folder's own
 * (MODULE_OWN_BASES). One entry per node NAME; a directory is never one.
 */
export function nodeFiles(
  folder: string,
  relDir: string,
): { node: string; file: ModuleFile }[] {
  const out: { node: string; file: ModuleFile }[] = [];
  for (const [base, name] of [...yamlFilesIn(folder)].sort()) {
    // The generic, the panel, the preset shelf and the MIDI map are the module ITSELF, not uses of it.
    if (MODULE_OWN_BASES.has(base)) continue;
    out.push({
      node: base,
      file: { path: join(folder, name), rel: `${relDir}/${name}` },
    });
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
  const out: { id: string; file: ModuleFile }[] = [];
  for (const [base, name] of [...yamlFilesIn(folder)].sort())
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

/** Read one module file, validating it in process. */
export function readModuleFile(file: ModuleFile): ReadModule {
  const { value, issues } = parseModule(readFileSync(file.path, "utf8"));
  return {
    value: (value as Record<string, unknown> | null) ?? null,
    issues: issues.map((i: ModuleIssue) => formatIssue(file.rel, i)),
  };
}

/** Is `dir` a st0 project — does it hold a `project.yaml` (or `.yml`)? */
export function isProjectFolder(dir: string): boolean {
  try {
    return entityFileFor(dir, "", "project") !== null;
  } catch {
    return false;
  }
}
