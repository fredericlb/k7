// pluginNeeds.ts — the plugins a project needs its ENGINE to host: the internal ones and the
// externals (VST and kin), each once — and how compatible an engine's catalogue is with them.
// Read WITHOUT opening the project: the engine is exactly what has not been chosen yet. Scored
// here when the project lives on the engine's machine, in the browser when it lives on the
// server; one formula either way (@studio/web-protocol/compat). See docs/fileRoutes.md.

import { loadGraph } from "@studio/song/graph";
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
  return compatOfNeeds(pluginNeedsOf(dir), catalogue);
}

/** …from needs already read: the workspace keeps them per project, since reading them loads the whole graph. */
export function compatOfNeeds(
  needs: PluginNeed[],
  catalogue: CataloguePlugin[],
): Compatibility | null {
  // An empty scan is "we cannot say", never "nothing installed" (docs/enginePlugin.md) — unless nothing is asked of it.
  if (!catalogue.length && needs.length) return null;
  return compatibility(needs, catalogue);
}

/**
 * Every plugin the project's modules use, deduplicated, sorted for a stable answer. A plugin baked
 * into a render — a manual freeze or an automatic VST one — COUNTS all the same: the render lets an
 * engine without it play the song, but not edit that track, so it stays a compatibility loss
 * (packages/song/docs/autoFreeze.md).
 */
export function pluginNeedsOf(dir: string): PluginNeed[] {
  const g = loadGraph(dir);
  const needs = new Map<string, PluginNeed>();
  for (const module of Object.values(g.modules)) {
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
