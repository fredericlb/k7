// moduleFork.ts — taking ownership of a module the ENGINE merely reports: it has no folder at
// all, so wanting a face or presets for one materialises it into the workspace's `_modules` here.
// A `@workspace` or `@st0` module that already HAS a folder is simply edited in place — there is
// no project-local copy to fork into instead. Rationale: docs/moduleFork.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { namePart } from "@studio/song-schema/instanceName";
import { parseGraph, renameNode } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import { deriveChains } from "./chainsGraph";
import { engineModules } from "./engineCatalogue";
import { MODULE_TYPES, moduleRefOf } from "./loader";
import type { LoadedModule } from "./rawDoc";
import {
  moduleLibraryDirs,
  moduleNamespaceOf,
  SHARED_MODULES_PATH,
} from "./sharedFolders";
import { loadUiLibrary, writeUiFile } from "./uiLibrary";
import { entityFileFor } from "./yaml/moduleIO";

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

/** The shared roots this project inherits, each under the namespace its LOCATION gives it — docs/moduleFork.md. */
export function sharedRoots(dir: string): { root: string; ns: string }[] {
  return moduleLibraryDirs(dir).map((root) => ({
    root,
    ns: moduleNamespaceOf(root),
  }));
}

/** The ref a shared module file answers to, keyed exactly as readModuleTree does — docs/moduleFork.md. */
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

/** Every chain that reaches `module`, `out` counting as well as `use` — see docs/moduleFork.md. */
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

/** Give a module the ENGINE merely reports a folder of its own — docs/moduleFork.md. */
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

  // Named after the ref's own slug, bare — not `instanceName`, see docs/moduleFork.md.
  const stem = namePart(String(found.file ?? ref.split("/").pop() ?? "module"));
  // Same workspace-level home a fork gets — an engine module given a folder is an ordinary
  // `@workspace` module from that point on, docs/moduleFork.md.
  const typeDir = resolve(dir, SHARED_MODULES_PATH, type);
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
  const localRef = `@workspace/${moduleRefOf(type, module)}`;
  if (panel)
    writeUiFile(dir, localRef, panel.ui, `panel for ${localRef} (was ${ref})`);

  // Repointed AFTER the file exists, same rule as a fork: a chain naming a module with no file won't load.
  const graphFile = entityFileFor(dir, "", GRAPH_BASE);
  let chains: string[] = [];
  if (graphFile) {
    const text = readFileSync(graphFile.path, "utf8");
    const r = renameNode(text, ref, localRef);
    if (r.text !== text) writeFileSync(graphFile.path, r.text, "utf8");
    chains = chainsUsing(r.text, localRef);
  }

  return {
    ref,
    module,
    path: `${SHARED_MODULES_PATH}/${type}/${module}/module.yaml`,
    chains,
  };
}
