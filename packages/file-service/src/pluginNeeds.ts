// pluginNeeds.ts — the plugins a project needs its ENGINE to host: the internal ones and the
// externals (VST and kin), each once. What a browser scores an engine's catalogue against before
// choosing it (packages/engine-browser/src/compat.ts), so it is read WITHOUT opening the project —
// the engine is exactly what has not been chosen yet. See docs/fileRoutes.md.

import { loadGraph } from "@studio/song/graph";
import { EXTERNAL_PLUGIN_FORMATS } from "@studio/song/project";
import { hostsPlugin } from "@studio/song-schema/moduleTypes";

/** One plugin as the project authors it: `format` lowercased ("internal", "vst3"…). */
export interface PluginNeed {
  format: string;
  name: string;
}

/** Every plugin the project's modules load from the engine, deduplicated, sorted for a stable answer. */
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
