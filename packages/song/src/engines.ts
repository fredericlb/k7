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
import { parse as parseYaml } from "yaml";
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
  "category",
  "label",
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
  return {
    ...face,
    ...own,
    engine: name,
    // The engine's defaults, then what this module or node set for THAT engine — never its top-level params.
    params: { ...(face.params ?? {}), ...(engineParams(m, name) ?? {}) },
  } as T;
}
