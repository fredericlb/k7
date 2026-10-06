// engines.ts — finding a module's ENGINES on disk, and running a module as the one that is on.
// An engine is an ordinary module folder under `engines/`, loaded under `<ref>/engines/<name>`;
// what the module itself keeps is its identity and its place in the graph, never the engine's
// plugin or panel. Rationale: docs/engines.md.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  currentEngine,
  ENGINE_NAME,
  ENGINES_DIR,
  engineNames,
  engineParams,
} from "@studio/song-schema/engines";
import {
  FILE_PARAMS,
  isLibraryFileParam,
  LIBRARY_FILE_PARAMS,
} from "@studio/song-schema/moduleTypes";
import { parse as parseYaml } from "yaml";
import { libraryFile, resolveFileParamIn } from "./libraryFiles";
import type { LoadedModule } from "./rawDoc";
import { moduleFileFor } from "./yaml/moduleIO";

/** The engine names a module folder holds: each sub-folder of `engines/` with a module file in it. */
export function engineFoldersOf(folder: string | undefined): string[] {
  if (!folder) return [];
  const dir = join(folder, ENGINES_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no engines/ — the ordinary module
  }
  return names
    .filter((n) => ENGINE_NAME.test(n))
    .filter((n) => {
      try {
        return statSync(join(dir, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(
      (n) => !!moduleFileFor(join(dir, n), `${ENGINES_DIR}/${n}`, "module"),
    )
    .sort();
}

/** The engines beside a module FILE and the one it names — what the builder's strip draws. */
export function enginesBeside(moduleFile: string): {
  engines: string[];
  engine?: string;
} {
  const folders = engineFoldersOf(dirname(moduleFile));
  const engineRefs = Object.fromEntries(folders.map((n) => [n, n]));
  let named: unknown;
  try {
    named = (
      parseYaml(readFileSync(moduleFile, "utf8")) as { engine?: unknown }
    )?.engine;
  } catch {
    named = undefined; // unreadable or half-typed: the default rule answers
  }
  return {
    engines: engineNames({ engineRefs }),
    engine: currentEngine({ engine: named, engineRefs }),
  };
}

/** What a module keeps of ITSELF when it runs as an engine — who it is and how it sits in the graph. */
const KEPT = [
  "name",
  "node",
  "file",
  "home",
  "presetRel",
  "chain",
  "nodeId",
  "category",
  "status",
  "alternatives",
  "alternative",
  "engines",
  "engineRefs",
  "mix",
  "input_volume",
  "output_volume",
  "automations",
  "color",
  "disabled",
  "content",
  "frozen",
] as const;

/** `m` run as its selected engine, `fold` resolving the engine's own ancestry — null when it has none. */
export function asEngine<T extends LoadedModule>(
  m: T,
  byRef: Record<string, LoadedModule>,
  fold: (engine: LoadedModule) => T,
): T | null {
  const name = currentEngine(m);
  const ref = name ? m.engineRefs?.[name] : undefined;
  const engine = ref ? byRef[ref] : undefined;
  if (!name || !engine) return null;
  const face = fold(engine) as LoadedModule;
  const own: Record<string, unknown> = {};
  const src = m as unknown as Record<string, unknown>;
  for (const k of KEPT) if (src[k] !== undefined) own[k] = src[k];
  const set = engineParams(m, name) ?? {};
  return {
    ...face,
    ...own,
    engine: name,
    // The engine's defaults, then what this module or node set for THAT engine — never its top-level params.
    params: { ...(face.params ?? {}), ...set },
    // …and a FILE it set there is the file the engine loads, not the engine's default one.
    ...withFiles(face, engineFiles(set, [face.folderAbs, m.folderAbs])),
  } as T;
}

/** The resolved files over the engine's, their authored names MERGED into its own rather than replacing them. */
const withFiles = (
  face: LoadedModule,
  files: Partial<LoadedModule>,
): Partial<LoadedModule> =>
  files.assets
    ? { ...files, assets: { ...(face.assets ?? {}), ...files.assets } }
    : files;

/** The files a set of engine params names, resolved the way the loader resolves a module's own (loader.ts resolveAssets). */
function engineFiles(
  set: Record<string, number | string>,
  folders: (string | undefined)[],
): Partial<LoadedModule> {
  const out: Record<string, string | undefined> = {};
  const assets: Record<string, string> = {};
  for (const [k, v] of Object.entries(set)) {
    if (typeof v !== "string" || !v) continue;
    if ((FILE_PARAMS as readonly string[]).includes(k))
      out[k] = resolveFileParamIn(k, v, folders);
    else if (isLibraryFileParam(k))
      out[k] = libraryFile(LIBRARY_FILE_PARAMS[k], v);
    else continue;
    assets[k] = v;
  }
  return Object.keys(assets).length ? { ...out, assets } : {};
}
