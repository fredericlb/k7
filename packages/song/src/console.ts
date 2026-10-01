// console.ts — a summing CONSOLE over the whole mix: `project.console` names a system, a folder of
// a library's `console/` holding a `channel` and a `buss` module, and the compile places the two
// halves — the channel after every lane's strip, the buss first on the master. One setting per
// project because the halves only work as a matched pair. Rationale: docs/console.md.

import { enginePlugin, MIXER_PLUGIN } from "@studio/engine-protocol/build";
import type { PluginDoc, ProjectDoc } from "@studio/engine-protocol/project";
import { CONSOLE_TYPE, moduleLabelOf } from "@studio/song-schema/moduleTypes";
import { resolveModuleRef } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

/** What the halves' plugin ids start with: `@` begins a ref and never a node name, so no chain step can produce one. */
export const CONSOLE_ID = "@console:";

/** The two halves a system folder holds, by their folder name. */
export const CONSOLE_HALVES = ["channel", "buss"] as const;

/** A system as a picker lists it: the ref a project names, and what to call it. */
export interface ConsoleSystem {
  ref: string;
  label: string;
}

/** The ref of a console system's half — `@st0/console/console-6` → `…/channel`. */
const halfRef = (system: string, half: string): string => `${system}/${half}`;

/** Every system the project's libraries hold: a `console/<system>/` with BOTH halves in it. */
export function consoleSystems(
  byRef: Record<string, LoadedModule>,
): ConsoleSystem[] {
  const at = new RegExp(`^(@[^/]+/${CONSOLE_TYPE}/[^/]+)/channel$`);
  const out: ConsoleSystem[] = [];
  for (const ref of Object.keys(byRef)) {
    const system = at.exec(ref)?.[1];
    if (!system || !byRef[halfRef(system, "buss")]) continue;
    // The channel's own label, its "Channel" dropped: the half is the module, the system is the choice.
    const label = moduleLabelOf(byRef[ref])?.replace(/\s*Channel$/i, "");
    out.push({
      ref: system,
      label: label || system.split("/").pop() || system,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** One half as the plugin the engine runs, under a `CONSOLE_ID` id. */
function halfPlugin(module: LoadedModule, id: string): PluginDoc {
  const { type, name } = enginePlugin(module.plugin, id, "audio");
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(module.params ?? {}))
    if (typeof v === "number") params[k] = v;
  return {
    id,
    type,
    name,
    path: String(module.preset ?? ""),
    presetSave: "",
    role: "",
    enabled: true,
    params,
  };
}

/** `doc` with `system`'s two halves placed; refused, like any unresolved ref, when the system is not there. */
export function withConsole(
  doc: ProjectDoc,
  system: string | undefined,
  byRef: Record<string, LoadedModule>,
): ProjectDoc {
  if (!system) return doc;
  const [channel, buss] = CONSOLE_HALVES.map((h) =>
    resolveModuleRef(halfRef(system, h), byRef),
  );
  if (!channel || !buss)
    throw new Error(
      `unresolved reference(s):\n  - project.console '${system}': no ${!channel ? "channel" : "buss"} module there`,
    );
  return {
    ...doc,
    tracks: doc.tracks.map((t) => {
      // A lane leaving by CUE never reaches the sum, and a bus return was encoded by the lanes sending to it.
      if (t.outputChannels.length || t.role === "effect") return t;
      const plugins = [...t.plugins];
      let at = -1;
      plugins.forEach((p, i) => {
        if (p.type === MIXER_PLUGIN) at = i;
      });
      // After the strip, so the fader and the pan act before the encode; a lane with no strip ends with it.
      plugins.splice(
        at >= 0 ? at + 1 : plugins.length,
        0,
        halfPlugin(channel, `${CONSOLE_ID}${t.id}`),
      );
      return { ...t, plugins };
    }),
    // First on the master, before anything else treats the sum.
    masterPlugins: [
      halfPlugin(buss, `${CONSOLE_ID}master`),
      ...doc.masterPlugins,
    ],
  };
}
