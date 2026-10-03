// preset.ts — `node preset`: a node's presets, files in a `presets/` tree keyed by the module it
// extends. Apply writes the values into the NODE's file and reaches the engine as a values-only
// diff when it can; save and update write the preset file and touch no project. See
// packages/song/docs/userPresets.md.

import {
  applyPresetToNode,
  listNodePresets,
  presetFile,
  presetRefOf,
  writeNodePreset,
} from "@studio/song-edit/presets";
import { WORKSPACE_SCOPE } from "@studio/song-schema/presets";
import type { SidHandler } from "../commands.ts";
import { withModuleParams } from "../moduleValues";

/** Words, a "quoted" one kept whole — a preset's name may hold spaces. */
const args = (a: string): string[] =>
  [...a.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

export const PRESET_VERBS: Record<string, SidHandler> = {
  "node.preset.apply": async (a, h) => {
    const [node, scope, name] = args(a);
    if (!node)
      return h.refuse(['usage: node preset apply <node> <scope> "<name>"']);
    try {
      if (!scope || !name) {
        // The list is the useful answer to "which ones are there?", so a bare call says it.
        const { ref, presets } = listNodePresets(h.songPath, node);
        h.log([
          !ref
            ? `${node} extends no module, so it has no presets`
            : presets.length
              ? `${node} (${ref}): ${presets.map((p) => `${p.scope}:${p.name}`).join("  ")}`
              : `${node} (${ref}) has no presets — 'node preset save ${node} <name>' keeps one`,
        ]);
        return;
      }
      const done = applyPresetToNode(h.songPath, node, scope, name);
      h.log([
        `${node}: preset '${name}' (${scope})${done.missingEngine ? ` — its engine '${done.missingEngine}' is not here, applied onto the current one` : ""}`,
      ]);
      // Another engine is another plugin; otherwise the values reach the engine as a diff.
      const np = done.switched
        ? null
        : withModuleParams(h.project(), node, done.params, false);
      if (np) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.refuse([`node preset: ${(e as Error).message}`]);
    }
  },

  "node.preset.save": async (a, h) => {
    const [node, name, scope = WORKSPACE_SCOPE] = args(a);
    if (!node || !name)
      return h.refuse([
        'usage: node preset save <node> "<name>" [workspace|<library>]',
      ]);
    try {
      const { ref } = writeNodePreset(h.songPath, node, scope, name, "new");
      h.log([`${node}: saved preset '${name}' for ${ref} in ${scope}`]);
    } catch (e) {
      h.refuse([`node preset save: ${(e as Error).message}`]);
    }
  },

  "node.preset.update": async (a, h) => {
    const [node, scope, name] = args(a);
    if (!node || !scope || !name)
      return h.refuse(['usage: node preset update <node> <scope> "<name>"']);
    try {
      const ref = presetRefOf(h.songPath, node);
      // Undo can only restore what it saw before the overwrite.
      if (ref) h.snapshot?.(presetFile(h.songPath, scope, ref, name));
      writeNodePreset(h.songPath, node, scope, name, "update");
      h.log([`${node}: updated preset '${name}' in ${scope}`]);
    } catch (e) {
      h.refuse([`node preset update: ${(e as Error).message}`]);
    }
  },
};
