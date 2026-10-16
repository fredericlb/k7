// workspaceModules.ts — the module side of a workspace: the libraries a project reaches, a module
// created, cloned, used as a node, its bases and its panel. Workspace keeps the public methods and
// hands these its path guards through ModulesHost. See docs/workspace.md.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { ASSEMBLY_FILE, libraryAssemblies } from "@studio/song/assemblies";
import { moduleBaseChoices } from "@studio/song/basePreset";
import { type ConsoleSystem, consoleSystems } from "@studio/song/console";
import { engineModules } from "@studio/song/engineCatalogue";
import { libraryChainDirs } from "@studio/song/libraryChains";
import {
  cloneModuleFile,
  createNode,
  freeNodeName,
  loadModuleRefs,
  moduleRefOf,
  withModuleStamp,
} from "@studio/song/loader";
import { sharedModuleRef } from "@studio/song/moduleFork";
import {
  accountLibraries,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "@studio/song/sharedFolders";
import { UI_FILE, uiFileText } from "@studio/song/uiLibrary";
import {
  realPath,
  wsExists,
  wsRead,
  wsWrite,
} from "@studio/song/yaml/workspaceFile";
import {
  ENGINE_NS,
  type ModuleNamespace,
} from "@studio/song-schema/moduleTypes";
import type { FileNode, ModuleLibrary } from "@studio/web-protocol";
import { parse as parseYaml } from "yaml";

/** The members of the workspace these read and write through. */
export interface ModulesHost {
  readonly root: string;
  activeProject(): string | null;
  requireActive(): string;
  safePath(rel: string): string;
  toRel(abs: string): string;
  /** The file tree under `abs`, as the editor draws it. */
  tree(abs: string): FileNode[];
  assertLibraryWritable(abs: string, verb?: string): void;
  invalidateProjectDoc(): void;
}

// A project FILE by name — every "file or folder?" test asks this rather than naming an extension.
const PROJECT_FILE = /\.(ya?ml|k7x)$/i;

/** `@engine` as a library — synthesised, not a folder. See docs/workspace.md. */
function engineLibrary(): ModuleLibrary | null {
  const byType = new Map<string, FileNode[]>();
  for (const [ref, m] of Object.entries(engineModules()) as [
    string,
    { category?: unknown; file?: unknown },
  ][]) {
    const type = String(m.category ?? "audio");
    const list = byType.get(type) ?? [];
    // A LEAF deliberately: a row that draws the name and opens nothing is the truth about a scan.
    list.push({
      name: String(m.file ?? ref),
      path: ref,
      dir: false,
      kind: "text",
    });
    byType.set(type, list);
  }
  if (!byType.size) return null;
  const nodes = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, children]) => ({
      name: type,
      // Synthetic — no such folder exists. Unique per type, which is all the tree needs it for.
      path: `${ENGINE_NS}/${type}`,
      dir: true,
      children: children.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  return { ns: "engine", path: "", exists: true, readOnly: true, nodes };
}

/** The module libraries this project can reach, in precedence order — see docs/workspace.md. */
export function moduleLibrariesOf(h: ModulesHost): ModuleLibrary[] {
  const dir = h.activeProject() ?? h.root;
  const roots: { ns: ModuleNamespace; abs: string }[] = moduleLibraryDirs(
    dir,
  ).map((abs) => ({
    ns: moduleNamespaceOf(abs),
    abs,
  }));
  // Every library is a row, one with no `modules/` yet included: its chains are listed under it.
  for (const lib of accountLibraries(dir))
    if (!roots.some((r) => r.ns === lib.name))
      roots.push({ ns: lib.name, abs: join(lib.root, "modules") });
  const out: ModuleLibrary[] = roots.map(({ ns, abs }) => {
    const exists = existsSync(abs);
    // A library REPOSITORY's sound folders too, walked like its modules: the tab draws them and takes drops on them.
    const lib = accountLibraries(dir).find((l) => l.name === ns);
    const sounds = (family: "samples" | "irs" | "wavetables" | "models") => {
      const at = lib ? join(lib.root, family) : null;
      return at && existsSync(at) ? h.tree(at) : [];
    };
    return {
      ns,
      path: h.toRel(abs),
      exists,
      nodes: exists ? h.tree(abs) : [],
      ...(lib
        ? {
            samples: sounds("samples"),
            irs: sounds("irs"),
            wavetables: sounds("wavetables"),
            models: sounds("models"),
          }
        : {}),
    };
  });
  const engine = engineLibrary();
  if (engine) out.push(engine);
  return out;
}

/** The CHAINS the account's libraries hold, by `@<library>/<path>`: `path` is the chain's file, or a folder chain's folder. */
export function libraryChainsOf(
  h: ModulesHost,
): { ref: string; path: string; nodes: string[] }[] {
  // The walk is shared with the ACCOUNT's own listing, which has no workspace to be relative to.
  return libraryChainDirs(h.activeProject() ?? h.root).map((c) => ({
    ref: c.ref,
    path: h.toRel(c.at),
    nodes: c.nodes,
  }));
}

/** The ASSEMBLY templates the library holds; `file` is answered here, never joined in a browser. */
export function libraryAssembliesOf(
  h: ModulesHost,
): { ref: string; path: string; file: string }[] {
  return libraryAssemblies(h.activeProject() ?? h.root).map((a) => ({
    ref: a.ref,
    path: h.toRel(a.path),
    file: h.toRel(join(a.path, ASSEMBLY_FILE)),
  }));
}

/** Make an empty module in one of those libraries, creating the folder on the way. */
export function createModuleIn(
  h: ModulesHost,
  root: string,
  rel: string,
): { path: string; dir: string } {
  const segs = rel.split("/").filter(Boolean);
  // At least a TYPE folder and a name: `audio/reverb` is the shortest thing the loader will key.
  if (segs.length < 2)
    throw new Error(
      `a module is named <type>/<name> — '${rel}' names no type folder`,
    );
  for (const seg of segs)
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(seg))
      throw new Error(`'${seg}' is not something a folder can be called`);
  // Through safePath, so a `..` in either part cannot leave the workspace.
  const dir = h.safePath(`${root}/${segs.join("/")}`);
  h.assertLibraryWritable(dir, "create a module in");
  const file = join(dir, "module.yaml");
  if (wsExists(file))
    throw new Error(`${h.toRel(realPath(file))} already exists`);
  mkdirSync(dir, { recursive: true });
  wsWrite(file, `# ${segs[segs.length - 1]}\nplugin:\n  type: \n  name: \n`);
  h.invalidateProjectDoc();
  return { path: h.toRel(realPath(file)), dir: h.toRel(dir) };
}

/** The named bases the module at `rel` may be set to, ancestors included — docs/workspace.md. */
export function moduleBasesOf(h: ModulesHost, rel: string): string[] {
  const abs = h.safePath(rel);
  const dir = h.activeProject() ?? h.root;
  try {
    const refs = withModuleStamp(dir, () => loadModuleRefs(dir)) as Record<
      string,
      { extends?: unknown; folderAbs?: unknown }
    >;
    // The module is addressed by its FILE, so its folder is that file's, and its `extends` the map's.
    const folderAbs = dirname(abs);
    const self = Object.values(refs).find((m) => m.folderAbs === folderAbs);
    return moduleBaseChoices({ folderAbs, extends: self?.extends }, refs);
  } catch {
    return [];
  }
}

/** Where a named BASE goes: `base/<name>.vstpreset` beside the module file — docs/workspace.md. */
export function baseSnapshotPathOf(
  h: ModulesHost,
  rel: string,
  name: string,
): { abs: string; path: string } {
  const moduleAbs = h.safePath(rel);
  const clean = basename(name).replace(/[\\/]/g, "").trim();
  if (!clean || clean === "." || clean === "..")
    throw new Error(`invalid name: ${name}`);
  // Spelt once whether or not the user typed it: `warm` and `warm.vstpreset` are one base.
  const leaf = clean.endsWith(".vstpreset") ? clean : `${clean}.vstpreset`;
  const dir = h.safePath(h.toRel(join(dirname(moduleAbs), "base")));
  const abs = h.safePath(h.toRel(join(dir, leaf)));
  h.assertLibraryWritable(abs, "snapshot a base into");
  mkdirSync(dir, { recursive: true });
  return { abs, path: h.toRel(abs) };
}

/** The module folder `abs` names: the folder itself, or the folder of a file inside it. */
function moduleDirOf(abs: string): string {
  return PROJECT_FILE.test(basename(abs)) ? dirname(abs) : abs;
}

// Clone a module folder under a new name; `rel` may be the folder or any file inside it.
export function cloneModuleIn(
  h: ModulesHost,
  rel: string,
  newName: string,
): { path: string } {
  // A clone copies the whole folder, so the MODULE is what's cloned whichever of its files the caller had open.
  const modDir = moduleDirOf(h.safePath(rel));
  const category = basename(dirname(modDir));
  const name = basename(modDir);
  const dir = h.requireActive();
  const newPath = cloneModuleFile(dir, category, name, newName);
  h.invalidateProjectDoc();
  // Re-rooted to the workspace: a clone now lands in `_modules`, beside the project rather than under it.
  return { path: h.toRel(join(dir, newPath)) };
}

/** Add one USE of a module; the file lands in the project's flat `nodes/`, NOT under `rel`. */
export function createNodeIn(
  h: ModulesHost,
  rel: string,
  node?: string,
): { path: string } {
  const modDir = moduleDirOf(h.safePath(rel));
  const category = basename(dirname(modDir));
  const name = basename(modDir);
  const dir = h.requireActive();
  // Unnamed is the ordinary case, so `<module>_<n>` — no lane prefix, this one is not born in a chain.
  const newPath = createNode(
    dir,
    category,
    name,
    node || freeNodeName(dir, name),
  );
  h.invalidateProjectDoc();
  return { path: newPath };
}

// "…/modules/<type>/<name>/<file>" -> the ref the loader keys that module by; null for anything else.
function localModuleRef(dir: string, abs: string): string | null {
  const segs = relative(dir, abs).split(sep);
  if (segs.length < 4 || segs[0] !== "modules") return null;
  // Everything between the TYPE and the file is the name, so a FILED module keys too.
  return moduleRefOf(segs[1], segs.slice(2, -1).join("/"));
}

/** The `ui.yaml` panel beside a module file, or the path it WOULD take plus a scaffold. */
export function moduleUiOf(
  h: ModulesHost,
  rel: string,
): { ref: string; path: string; content: string; exists: boolean } {
  const abs = h.safePath(rel);
  const dir = h.requireActive();
  const ref = sharedModuleRef(dir, abs)?.ref ?? localModuleRef(dir, abs);
  if (!ref) throw new Error(`${h.toRel(abs)} is not a module file`);
  // One of the module's own files beside `abs`, or the path it would take plus a scaffold.
  const path = join(dirname(abs), UI_FILE);
  const exists = existsSync(path);
  return {
    ref,
    path: h.toRel(path),
    content: exists
      ? readFileSync(path, "utf8")
      : uiFileText({ cols: 4, rows: 2, widgets: {} }, `panel for ${ref}`),
    exists,
  };
}

/** The console systems the libraries hold, and the one the project at `dir` runs — packages/song/docs/console.md. */
export function consolesIn(dir: string): {
  systems: ConsoleSystem[];
  current?: string;
} {
  let current: string | undefined;
  try {
    const root = parseYaml(wsRead(join(dir, "project.yaml"))) as {
      project?: { console?: unknown };
    };
    if (typeof root?.project?.console === "string")
      current = root.project.console;
  } catch {
    current = undefined; // no project.yaml, or one that will not read: the compile says so, not this
  }
  return { systems: consoleSystems(loadModuleRefs(dir)), current };
}
