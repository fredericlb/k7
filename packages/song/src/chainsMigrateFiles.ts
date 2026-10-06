// chainsMigrateFiles.ts — a node project (`graph.yaml` + `nodes/`) rewritten as `chains/` + `tracks/`
// + `vstpresets/` + `assets/` + `layout.yaml`. Every non-lane node gets an `id` and loses its name; a
// lane keeps its name, which is its file in `tracks/`. Refuses what it cannot carry over. docs/chainFiles.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { isIoSource } from "@studio/song-schema/moduleTypes";
import type { Item } from "@studio/song-schema/yaml/chainSchema";
import {
  ASSETS_DIR,
  TRACKS_DIR,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parse } from "yaml";
import {
  fromSegments,
  isChainProject,
  newNodeId,
  writeChainProject,
  writeLayout,
} from "./chainProject";
import {
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
} from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { lanesOf } from "./trackModule";

export interface FilesMigration {
  /** Old node name → its id, for everything that is not a lane. */
  ids: Record<string, string>;
  /** Nodes no chain reaches: written as loose chains, hidden unless placed. */
  loose: string[];
  chains: string[];
}

/** Why this project cannot be migrated yet, or null — each reason names a file that refers to nodes by NAME. */
export function migrationBlocker(dir: string): string | null {
  if (isChainProject(dir)) return "already a chain project";
  if (!existsSync(join(dir, GRAPH_FILE))) return `no ${GRAPH_FILE}`;
  if (existsSync(join(dir, "assemblies"))) return "assemblies/ names nodes";
  if (existsSync(join(dir, "views"))) return "views/ binds node params";
  // Only what this knows how to move: node files, their presets, `assets/` and `base/`.
  const nodes = join(dir, "nodes");
  for (const f of existsSync(nodes) ? readdirSync(nodes) : [])
    if (!/\.(ya?ml|vstpreset)$/.test(f) && f !== "assets" && f !== "base")
      return `nodes/${f} is neither a node, a preset, assets/ nor base/`;
  const surf = join(dir, "surfaces");
  if (existsSync(surf))
    for (const f of readdirSync(surf))
      if (/mapping:/.test(readFileSync(join(surf, f), "utf8")))
        return `surfaces/${f} maps node params`;
  return null;
}

/** Rewrite `dir` in place; `dryRun` returns what would happen and touches nothing. */
export function migrateToChainFiles(
  dir: string,
  dryRun = false,
): FilesMigration {
  const blocker = migrationBlocker(dir);
  if (blocker) throw new Error(`cannot migrate ${dir}: ${blocker}`);
  const graph = loadChains(dir, loadProjectRoot(dir), true) as {
    modules?: Record<string, string[]>;
    positions?: Record<string, { x: number; y: number }>;
  };
  const modules = loadModules(dir, true);
  const resolved = resolveModuleMap(modules, loadModuleRefs(dir));
  const lanes = new Set(Object.keys(lanesOf(resolved)));
  const nodesDir = join(dir, "nodes");
  const ids: Record<string, string> = {};
  const raw = (n: string): Record<string, unknown> => {
    const f = join(nodesDir, `${n}.yaml`);
    return existsSync(f) ? (parse(readFileSync(f, "utf8")) ?? {}) : {};
  };
  const idOf = (n: string) => (ids[n] ??= newNodeId());
  const presetOf = (n: string) =>
    existsSync(join(nodesDir, `${n}.vstpreset`)) ? `${n}.vstpreset` : undefined;

  const itemOf = (n: string): Item => {
    if (lanes.has(n)) return { id: idOf(n), track: n };
    const p = presetOf(n);
    return { id: idOf(n), ...(p ? { vstpreset: p } : {}), ...raw(n) } as Item;
  };
  const isSource = (n: string) =>
    lanes.has(n) || isIoSource(resolved[n]?.io as string | undefined);

  const named = new Set(Object.keys(graph.modules ?? {}));
  for (const ds of Object.values(graph.modules ?? {}))
    for (const d of ds) named.add(d.split("#")[0]);
  const loose = Object.keys(modules).filter((n) => !named.has(n));

  const chains = fromSegments(graph, { itemOf, isSource, loose });
  // In memory a non-lane node is its id now, so the layout follows it there.
  const positions = Object.fromEntries(
    Object.entries(graph.positions ?? {}).map(([k, v]) => [
      lanes.has(k) || !ids[k] ? k : ids[k],
      v,
    ]),
  );
  const result = { ids, loose, chains: Object.keys(chains) };
  if (dryRun) return result;

  writeChainProject(dir, chains);
  writeLayout(dir, positions);
  mkdirSync(join(dir, TRACKS_DIR), { recursive: true });
  for (const n of lanes)
    if (existsSync(join(nodesDir, `${n}.yaml`)))
      renameSync(
        join(nodesDir, `${n}.yaml`),
        join(dir, TRACKS_DIR, `${n}.yaml`),
      );
  for (const f of existsSync(nodesDir) ? readdirSync(nodesDir) : []) {
    if (f.endsWith(".vstpreset")) {
      mkdirSync(join(dir, VSTPRESETS_DIR), { recursive: true });
      renameSync(join(nodesDir, f), join(dir, VSTPRESETS_DIR, f));
    } else if (f === "assets" || f === "base") {
      const to =
        f === "assets"
          ? join(dir, ASSETS_DIR)
          : join(dir, VSTPRESETS_DIR, "base");
      mkdirSync(to, { recursive: true });
      for (const a of readdirSync(join(nodesDir, f)))
        renameSync(join(nodesDir, f, a), join(to, a));
    }
  }
  rmSync(nodesDir, { recursive: true, force: true });
  rmSync(join(dir, GRAPH_FILE));
  return result;
}
