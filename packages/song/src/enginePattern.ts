// enginePattern.ts — a strudel lane with `clock: engine`: the plugin that plays its pattern IN the engine.
// The pattern's text travels in the document, since the engine parses no files — engine/st0-engine/docs/patternPlugin.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginDoc } from "./project";
import type { Lane } from "./trackModule";

// Must match PatternPlugin::xmlTypeName in the engine.
export const PATTERN_PLUGIN_TYPE = "studio_pattern";

/** True for a lane the ENGINE plays; the Node pattern clock leaves such a lane alone. */
export function isEngineClocked(t: Lane): boolean {
  return t.type === "strudel" && t.clock === "engine" && !!t.strudel;
}

/** Of a lane's compiled halves, the one that takes NOTES: its `midi` half, else the bare-wired one. */
export function notesHalf<H extends { port?: string }>(
  halves: H[],
): H | undefined {
  return halves.find((h) => h.port === "midi") ?? halves.find((h) => !h.port);
}

/** The plugin heading the lane's notes half: its source, and the lane's name as the label its events are picked by. */
export function patternPlugin(dir: string, lane: string, t: Lane): PluginDoc {
  let source = "";
  try {
    source = readFileSync(resolve(dir, String(t.strudel)), "utf8");
  } catch {
    // A missing file is already reported by the project's own validation; the lane then plays nothing.
  }
  return {
    id: `${lane}:pattern`,
    type: PATTERN_PLUGIN_TYPE,
    name: "Pattern",
    path: "",
    presetSave: "",
    role: "noteFX",
    enabled: true,
    params: {},
    patternSource: source,
    patternLabel: lane,
  };
}
