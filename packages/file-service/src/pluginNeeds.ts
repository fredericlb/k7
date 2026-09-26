// pluginNeeds.ts — the plugins a project needs its ENGINE to host: the internal ones and the
// externals (VST and kin), each once — and how compatible an engine's catalogue is with them.
// Read WITHOUT opening the project: the engine is exactly what has not been chosen yet. Scored
// here when the project lives on the engine's machine, in the browser when it lives on the
// server; one formula either way (@studio/web-protocol/compat). See docs/fileRoutes.md.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { activeFreezePlans } from "@studio/song/freeze";
import { type GraphDoc, loadGraph } from "@studio/song/graph";
import { compileWithAutoFreezes } from "@studio/song/nodeProject";
import { EXTERNAL_PLUGIN_FORMATS } from "@studio/song/project";
import { hostsPlugin } from "@studio/song-schema/moduleTypes";
import {
  type CataloguePlugin,
  type Compatibility,
  compatibility,
  type PluginNeed,
} from "@studio/web-protocol/compat";

export type { PluginNeed };

/** The project's needs scored against a catalogue; null when an EMPTY catalogue cannot say — the scan's own rule. */
export function projectCompatOf(
  dir: string,
  catalogue: CataloguePlugin[],
): Compatibility | null {
  const needs = pluginNeedsOf(dir);
  // An empty scan is "we cannot say", never "nothing installed" (docs/enginePlugin.md) — unless nothing is asked of it.
  if (!catalogue.length && needs.length) return null;
  return compatibility(needs, catalogue);
}

/** The modules a render plays instead of — manual freezes and automatic ones on disk: no engine loads their plugin. */
function bakedModules(dir: string, g: GraphDoc): Set<string> {
  const isLane = (n: string) => n in g.tracks;
  const baked = new Set<string>();
  for (const p of activeFreezePlans(g.chains, g.modules, isLane, (r) =>
    existsSync(resolve(dir, r)),
  ))
    for (const m of p.modules) baked.add(m);
  // The automatic freezes are what makes a VST project playable on an engine without the VST.
  try {
    for (const f of compileWithAutoFreezes(dir).freezes)
      if (f.ready) for (const m of f.plan.modules) baked.add(m);
  } catch {
    // A song that will not compile has no renders in force: every plugin counts.
  }
  return baked;
}

/** Every plugin the project's modules load from the engine, deduplicated, sorted for a stable answer. */
export function pluginNeedsOf(dir: string): PluginNeed[] {
  const g = loadGraph(dir);
  const baked = bakedModules(dir, g);
  const needs = new Map<string, PluginNeed>();
  for (const [node, module] of Object.entries(g.modules)) {
    if (baked.has(node)) continue;
    // The same test the graph's flags make: a plugin SLOT holding a plugin — docs/graphFlags.md.
    if (module.kind !== "plugin" || !hostsPlugin(module.category)) continue;
    const format = String(module.plugin?.type ?? "").toLowerCase();
    const name = String(module.plugin?.name ?? "");
    if (!name) continue;
    // jsdsp, Faust and offline are built from the project's own source, on whichever engine plays it.
    if (format !== "internal" && !EXTERNAL_PLUGIN_FORMATS.has(format)) continue;
    needs.set(`${format}|${name.toLowerCase()}`, { format, name });
  }
  return [...needs.values()].sort(
    (a, b) => a.format.localeCompare(b.format) || a.name.localeCompare(b.name),
  );
}
