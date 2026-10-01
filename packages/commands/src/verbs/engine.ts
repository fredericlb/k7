// engine.ts — `node engine`: run a module as another of its ENGINES. One write to the node's
// file (`engine:` on the attribute set that is on) and a reload, never a values-only push: another
// engine is another plugin. See packages/song/docs/engines.md.

import {
  moduleEngines,
  selectModuleEngine,
} from "@studio/song-edit/engineSwitch";
import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const ENGINE_VERBS: Record<string, SidHandler> = {
  "node.engine": async (a, h) => {
    const [module, name] = splitWords(a);
    if (!module) return h.refuse(["usage: node engine <node> [name]"]);
    try {
      if (!name) {
        // The list is the useful answer to "which ones are there?", so a bare call says it.
        const { names, current } = moduleEngines(h.songPath, module);
        h.log([
          names.length
            ? `${module}: ${names.map((n) => (n === current ? `[${n}]` : n)).join("  ")}`
            : `${module} has no engines`,
        ]);
        return;
      }
      selectModuleEngine(h.songPath, module, name);
      h.log([`${module}: running engine '${name}'`]);
      await h.reload();
    } catch (e) {
      h.refuse([`node engine: ${(e as Error).message}`]);
    }
  },
};
