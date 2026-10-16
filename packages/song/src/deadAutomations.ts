// deadAutomations.ts — the curves the engine will refuse, said where a person can see them: a lane bound
// to a built-in's plain-state control (its value is settable, no curve reaches it), or to a name the
// plugin does not have. The engine only logs those; this turns each into a project warning.
// See engine/k7-runtime/docs/builtinParams.md.

import { join } from "node:path";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { builtinParamAutomatable } from "@studio/song-schema/builtinParams";
import type { Diagnostic } from "./loader";
import { wsExists } from "./yaml/workspaceFile";

/** The names a compiled graph declares, or null when the plugin carries no graph. */
function graphParams(json: string | undefined): Set<string> | null {
  if (!json) return null;
  try {
    const g = JSON.parse(json) as { params?: { name?: unknown }[] };
    return new Set((g.params ?? []).map((p) => String(p.name)));
  } catch {
    return null;
  }
}

/** One warning per automation lane the engine cannot apply, pointing at the chain file holding the node. */
export function deadAutomations(dir: string, doc: ProjectDoc): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const t of doc.tracks)
    for (const lane of t.automation) {
      const plugin = t.plugins.find((p) => p.id === lane.pluginId);
      if (!plugin) continue;
      const declared = graphParams(plugin.dspGraph);
      const why = !builtinParamAutomatable(plugin.type, lane.param)
        ? `${plugin.type}'s '${lane.param}' is plain plugin state, which no curve can drive — pick an engine whose knobs automate`
        : declared && !declared.has(lane.param)
          ? `this module has no '${lane.param}' to automate (it has ${[...declared].join(", ") || "none"})`
          : null;
      if (!why) continue;
      const chain = (lane.pluginId ?? "").split(":")[0];
      const rel = `chains/${chain}.yaml`;
      out.push({
        file: wsExists(join(dir, rel)) ? rel : "project.yaml",
        line: 1,
        col: 1,
        severity: "warning",
        message: `a curve on '${lane.param}' does nothing: ${why}`,
      });
    }
  return out;
}
