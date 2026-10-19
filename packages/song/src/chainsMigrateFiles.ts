// chainsMigrateFiles.ts — a node project (`graph.k7x` + `nodes/`) rewritten as `chains/` + `tracks/`
// + `vstpresets/` + `assets/` + `layout.k7x`. Every non-lane node gets an `id` and loses its name; a
// lane keeps its name, which is its file in `tracks/`. Refuses what it cannot carry over. docs/chainFiles.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { isDocFile } from "@studio/song-schema/docExt";
import {
  isIoSource,
  isPicturePass as isPicturePassCategory,
  SHAPE_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import {
  ASSETS_DIR,
  type ChainFile,
  type Item,
  itemsOf,
  TRACKS_DIR,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { renameFadeChains } from "@studio/song-schema/yaml/videoTrackFile";
import {
  fromSegments,
  isChainProject,
  newNodeId,
  pictureLaneOf,
  writeChainProject,
  writeLayout,
} from "./chainProject";
import {
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
} from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { lanesOf } from "./trackModule";
import { entityFiles } from "./yaml/moduleIO";
import { wsData, wsEdit } from "./yaml/workspaceDoc";

export interface FilesMigration {
  /** Old node name → its id, for everything that is not a lane. */
  ids: Record<string, string>;
  /** Nodes no chain reaches: written as loose chains, hidden unless placed. */
  loose: string[];
  chains: string[];
}

/** Does a surface file bind node params, under a `mapping` key at any depth; a file that does not read counts as one. */
function mapsParams(path: string): boolean {
  let data: unknown;
  try {
    data = wsData(path);
  } catch {
    return true;
  }
  const has = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.some(has)
      : v !== null &&
        typeof v === "object" &&
        Object.entries(v).some(([k, x]) => k === "mapping" || has(x));
  return has(data);
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
    if (!/\.(k7x|vstpreset)$/.test(f) && f !== "assets" && f !== "base")
      return `nodes/${f} is neither a node, a preset, assets/ nor base/`;
  const surf = join(dir, "surfaces");
  if (existsSync(surf))
    for (const f of readdirSync(surf).filter(isDocFile))
      if (mapsParams(join(surf, f))) return `surfaces/${f} maps node params`;
  return null;
}

/** A fade named its stretch by the run's head NODE; in a chain file the stretch is a subchain, named by its id. */
function renameStretches(
  dir: string,
  chains: Record<string, ChainFile>,
  ids: Record<string, string>,
): void {
  const byId = new Map(Object.entries(ids).map(([n, id]) => [id, n]));
  const renames: Record<string, string> = {};
  for (const c of Object.values(chains)) {
    if (!pictureLaneOf(c)) continue;
    for (const sc of c.subchains ?? []) {
      const head = sc.steps.flatMap(itemsOf)[0];
      const was = head && byId.get(head.id);
      if (was) renames[was] = sc.id;
    }
  }
  if (!Object.keys(renames).length) return;
  for (const { file } of entityFiles(join(dir, "video_tracks"), "video_tracks"))
    wsEdit(file.path, (doc) => renameFadeChains(doc.at([]), renames));
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
  const refs = loadModuleRefs(dir);
  const resolved = resolveModuleMap(modules, refs);
  // A graph may name a module by its REF, with no node file: that node is the module itself.
  const moduleOf = (n: string) =>
    resolved[n] ?? (modules[n] ? undefined : refs[n]);
  const lanes = new Set(Object.keys(lanesOf(resolved)));
  // PICTURE lanes keep their `video_tracks/` file; only their item moves into a chain.
  const pictures = new Set(Object.keys(loadVideoTracks(dir)));
  const nodesDir = join(dir, "nodes");
  const ids: Record<string, string> = {};
  const raw = (n: string): Record<string, unknown> => {
    const f = join(nodesDir, `${n}.k7x`);
    return existsSync(f) ? wsData(f) : {};
  };
  const idOf = (n: string) => (ids[n] ??= newNodeId());
  const presetOf = (n: string) =>
    existsSync(join(nodesDir, `${n}.vstpreset`)) ? `${n}.vstpreset` : undefined;

  const itemOf = (n: string): Item => {
    if (lanes.has(n)) return { id: idOf(n), track: n };
    if (pictures.has(n)) return { id: idOf(n), video_track: n };
    const p = presetOf(n);
    const own = raw(n);
    // …written as an item extending that ref, which is what the graph meant by naming it.
    const ext = !modules[n] && refs[n] && !own.extends ? { extends: n } : {};
    return {
      id: idOf(n),
      ...(p ? { vstpreset: p } : {}),
      ...ext,
      ...own,
    } as Item;
  };
  const isSource = (n: string) =>
    lanes.has(n) ||
    pictures.has(n) ||
    isIoSource(moduleOf(n)?.io as string | undefined) ||
    // A SHAPE is a picture source too, drawn rather than filmed (song-video/docs/shapes.md).
    moduleOf(n)?.category === SHAPE_CATEGORY;

  const named = new Set(Object.keys(graph.modules ?? {}));
  for (const ds of Object.values(graph.modules ?? {}))
    for (const d of ds) named.add(d.split("#")[0]);
  const loose = Object.keys(modules).filter((n) => !named.has(n));

  const isPicturePass = (n: string) =>
    isPicturePassCategory(moduleOf(n)?.category as string | undefined);
  // A new chain is named after the leaf of what its head extends, as a graph edit names one.
  const nameFor = (head: string, taken: Set<string>): string => {
    const it = lanes.has(head) || pictures.has(head) ? null : itemOf(head);
    const ext = (it as { extends?: unknown } | null)?.extends;
    const base =
      (typeof ext === "string" ? ext : head)
        .split("/")
        .pop()
        ?.replace(/[^A-Za-z0-9_.-]/g, "_") || "chain";
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base}-${i}`;
    return n;
  };
  const chains = fromSegments(graph, {
    itemOf,
    isSource,
    loose,
    isPicturePass,
    nameFor,
  });
  // In memory a non-lane node is its id now, so the layout follows it there.
  const positions = Object.fromEntries(
    Object.entries(graph.positions ?? {}).map(([k, v]) => [
      lanes.has(k) || pictures.has(k) || !ids[k] ? k : ids[k],
      v,
    ]),
  );
  const result = { ids, loose, chains: Object.keys(chains) };
  if (dryRun) return result;

  writeChainProject(dir, chains);
  writeLayout(dir, positions);
  renameStretches(dir, chains, ids);
  mkdirSync(join(dir, TRACKS_DIR), { recursive: true });
  for (const n of lanes)
    if (existsSync(join(nodesDir, `${n}.k7x`)))
      renameSync(join(nodesDir, `${n}.k7x`), join(dir, TRACKS_DIR, `${n}.k7x`));
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
  rmSync(join(dir, GRAPH_FILE), { force: true });
  return result;
}
