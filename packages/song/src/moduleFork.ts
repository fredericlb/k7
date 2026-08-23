// moduleFork.ts — taking ownership of a module that isn't yours. Two ways in: a `_modules` library is shared
// by every project beside it, so a save aimed at one copies the whole module folder into the project and
// repoints every chain step that named it; and a module the ENGINE merely reports has no folder at all, so
// wanting a face or presets for one materialises it here. Rationale: docs/moduleFork.md.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { instanceName, namePart } from "@studio/song-schema/instanceName";
import { parseGraph, renameNode } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import { deriveChains } from "./chainsGraph";
import { engineModules } from "./engineCatalogue";
import { loadProjectRoot, MODULE_TYPES, moduleRefOf } from "./loader";
import type { LoadedModule } from "./rawDoc";
import { moduleLibraryDirs, moduleNamespaceOf } from "./sharedFolders";
import { loadUiLibrary, writeUiFile } from "./uiLibrary";
import { entityFileFor, moduleFileFor } from "./yaml/moduleIO";

export type ForkedModule = {
  /** The shared ref that was edited, e.g. "@engine/audio/delay/tape-delay". */
  ref: string;
  /** The local module the copy became — what the chains now name. */
  module: string;
  /** Project-relative path of the module file that holds the edit. */
  path: string;
  /** The chains repointed at the copy (empty when the project didn't play the module yet). */
  chains: string[];
};

const toPosix = (p: string): string => p.split(sep).join("/");

/** The shared roots this project inherits, absolute, each under the namespace its LOCATION gives it.
 *  Read through moduleLibraryDirs so the médiathèque is here too — a module the loader keys and the
 *  catalogue lists, but that this function did not see, was one the builder refused to open. */
export function sharedRoots(dir: string): { root: string; ns: string }[] {
  return moduleLibraryDirs(dir).map((root) => ({
    root,
    ns: moduleNamespaceOf(root),
  }));
}

/**
 * The ref a shared module file answers to, or null when the file isn't one.
 *
 * Mirrors readModuleTree's keying rather than guessing at it: `<type>/<leaf>` at the top level and
 * `<type>/<category>/<leaf>` one folder deeper (the loader's "a folder with no module file is a category"),
 * and nothing below that — so a path this returns a ref for is a path the loader will agree about.
 */
export function sharedModuleRef(
  dir: string,
  file: string,
): { ref: string; folder: string; leaf: string; type: string } | null {
  const abs = resolve(file);
  for (const { root, ns } of sharedRoots(dir)) {
    if (!abs.startsWith(root + sep)) continue;
    const segs = toPosix(relative(root, abs)).split("/");
    // [type, ...subs, filename] — at most one category folder between the type and the module.
    if (segs.length < 3 || segs.length > 4) return null;
    const [type, ...rest] = segs;
    if (!(type in MODULE_TYPES)) return null;
    const folder = dirname(abs);
    return {
      ref: `@${ns}/${type}/${rest.slice(0, -1).join("/")}`,
      folder,
      leaf: basename(folder),
      type,
    };
  }
  return null;
}

/**
 * Every chain that reaches `module`, by name — the tracks the edit is really about.
 *
 * `out` counts as well as `use`: a module several things feed is a chain of its own now, and a chain that only
 * ever names itself tells nobody anything. Its own chain is left out for exactly that reason.
 *
 * Exported because naming a fork after its track and naming a NODE after its lane are the same
 * question (instanceName.ts), and one question is entitled to one answer — the first chain this
 * returns is the owner in both.
 */
export function chainsUsing(text: string, module: string): string[] {
  const chains = deriveChains(parseGraph(text).value);
  return Object.entries(chains)
    .filter(
      ([name, c]) =>
        name !== module &&
        (c.use.some((s) => s.module === module) ||
          c.out.some((o) => o.to === module)),
    )
    .map(([name]) => name);
}

/**
 * Copy a shared module into this project, with `content` as its module file, and repoint the chains at it.
 *
 * Throws for anything that isn't a shared module's own module file — a sidecar forked on its own would land in
 * a folder no chain names, which is a silent no-op dressed up as a save.
 */
export function forkSharedModule(
  dir: string,
  file: string,
  content: string,
): ForkedModule {
  const found = sharedModuleRef(dir, file);
  if (!found)
    throw new Error(
      `${basename(file)}: the shared module library is read-only, and this file is not a module that can be copied into the project`,
    );
  const { ref, folder, leaf, type } = found;
  if (basename(file).replace(/\.[^.]+$/, "") !== "module")
    throw new Error(
      `${basename(file)}: the shared module library is read-only — edit ${leaf}'s module file to get a project copy of it`,
    );

  // Named after the chain that plays it, so a copy says whose it is. A module the project doesn't play yet has
  // no track to be named after — it still forks, or the edit would just be lost.
  const graphFile = entityFileFor(dir, "", GRAPH_BASE);
  const graphText = graphFile ? readFileSync(graphFile.path, "utf8") : "";
  const track = graphText ? (chainsUsing(graphText, ref)[0] ?? null) : null;
  const typeDir = join(dir, "modules", type);
  // The same `<owner>_<what>_<n>` a node is named by — one rule, in instanceName.ts.
  const module = instanceName(leaf, track, (n) => existsSync(join(typeDir, n)));
  const dest = join(typeDir, module);

  mkdirSync(typeDir, { recursive: true });
  cpSync(folder, dest, { recursive: true }); // sidecars included — a module is its folder
  const generic = moduleFileFor(dest, "", "module");
  writeFileSync(generic?.path ?? join(dest, "module.yaml"), content, "utf8");

  // The panel came along in the folder copy — it is a file in it (see uiLibrary.ts). Rewritten anyway, so its
  // header names the copy instead of the module it was drawn for: a `ui.yaml` whose comment still points at
  // `@engine/…` reads as the fork having borrowed a face rather than been given one.
  const panel = loadUiLibrary(dir).byRef[ref];
  const localRef = moduleRefOf(type, module); // the ref the LOADER will key the copy by, not the folder name
  if (panel)
    writeUiFile(
      dir,
      localRef,
      panel.ui,
      `panel for ${localRef} (copied from ${ref})`,
    );

  // Repointed AFTER the files exist: a chain naming a module with no file is what the compiler refuses to load.
  let chains: string[] = [];
  if (graphFile) {
    const r = renameNode(graphText, ref, module);
    if (r.text !== graphText) writeFileSync(graphFile.path, r.text, "utf8");
    // The chains as they now stand, so the report names what the copy plays in — not the
    // nodes that were rewired, which is a file-level detail nobody asked about.
    chains = chainsUsing(r.text, module);
  }

  return {
    ref,
    module,
    path: `modules/${type}/${module}/${basename(generic?.path ?? "module.yaml")}`,
    chains,
  };
}

/**
 * Give a module the ENGINE provides a folder of its own, in this project.
 *
 * A scanned plugin is a module with no files anywhere: `engineCatalogue` synthesises it from the scan cache, and
 * a chain can name it as `@engine/<slug>` without anything on disk. That is fine until you want to give it a
 * face or a shelf of presets, because both are FILES in a module's folder — so this is the moment the module
 * stops being ambient and becomes something the project owns.
 *
 * The same shape as a fork, and deliberately: a folder appears, a `module.yaml` records which plugin to load
 * (the scan is a discovery aid, not the project's memory of what it uses), and the chains are repointed. What
 * differs is that nothing is copied — there was nothing to copy.
 */
export function materialiseEngineModule(
  dir: string,
  ref: string,
  catalogue: Record<string, LoadedModule> = engineModules(),
): ForkedModule {
  const found = catalogue[ref];
  if (!found)
    throw new Error(
      `${ref} is not a module this machine's engine offers — nothing to give a folder to`,
    );
  const type = String(found.category ?? "");
  if (!(type in MODULE_TYPES))
    throw new Error(`${ref}: unknown module category '${type}'`);

  // Named after the slug the ref already carries, so the folder reads as the plugin it is. A name the project
  // has taken gets a counter, exactly as a fork does — two engine modules can slug the same.
  // Not `instanceName`: this one is named after a PLUGIN's own slug and wants it bare, so the
  // folder reads as the plugin it is. The counter only appears when the name is already taken.
  const stem = namePart(String(found.file ?? ref.split("/").pop() ?? "module"));
  const typeDir = join(dir, "modules", type);
  let module = stem;
  for (let n = 2; existsSync(join(typeDir, module)); n++)
    module = `${stem}_${n}`;

  mkdirSync(join(typeDir, module), { recursive: true });
  const plugin = found.plugin as { type?: unknown; name?: unknown } | undefined;
  const body = plugin
    ? `# ${module}: ${ref}, given a folder so it can carry a panel and presets.\n` +
      `plugin:\n` +
      `  type: ${JSON.stringify(String(plugin.type ?? ""))}\n` +
      `  name: ${JSON.stringify(String(plugin.name ?? ""))}\n`
    : // An io module the engine provides (IN / OUT) has no plugin — its `io:` IS its substance.
      `# ${module}: ${ref}, given a folder so it can carry a panel and presets.\n` +
      `io: ${JSON.stringify(String(found.io ?? ""))}\n`;
  writeFileSync(join(typeDir, module, "module.yaml"), body, "utf8");

  // The panel follows, if the engine module had one drawn under its ref somewhere readable.
  const panel = loadUiLibrary(dir).byRef[ref];
  const localRef = moduleRefOf(type, module);
  if (panel)
    writeUiFile(dir, localRef, panel.ui, `panel for ${localRef} (was ${ref})`);

  // Repointed AFTER the file exists, same rule as a fork: a chain naming a module with no file won't load.
  const graphFile = entityFileFor(dir, "", GRAPH_BASE);
  let chains: string[] = [];
  if (graphFile) {
    const text = readFileSync(graphFile.path, "utf8");
    const r = renameNode(text, ref, module);
    if (r.text !== text) writeFileSync(graphFile.path, r.text, "utf8");
    chains = chainsUsing(r.text, module);
  }

  return {
    ref,
    module,
    path: `modules/${type}/${module}/module.yaml`,
    chains,
  };
}
