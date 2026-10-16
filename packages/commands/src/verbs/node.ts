// node.ts — verbs on one node: its external UI, recorder takes, bypass, alternatives,
// freeze, deletion and replacement. See docs/verbs.md.

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXTERNAL_PLUGIN_FORMATS } from "@studio/engine-protocol/build";
import {
  dropNodeFromAssemblies,
  renameNodeInAssemblies,
} from "@studio/song/assemblyEdit";
import { confineTo } from "@studio/song/confine";
import { freezeBlockedBy, freezePlans } from "@studio/song/freeze";
import { loadGraph, parseChains } from "@studio/song/graph";
import {
  loadChains,
  loadModules,
  loadProjectRoot,
  nodeNameTaken,
} from "@studio/song/loader";
import type { ProjectDoc } from "@studio/song/project";
import { surfacesNaming } from "@studio/song/surfaces";
import { selectModuleAlternative } from "@studio/song-edit/alternativeSwitch";
import {
  deleteChainNode,
  laneOfNode,
  moduleAlternatives,
  newModuleAlternative,
  renameChainNode,
  setModuleBypass,
  setModuleExtends,
  setModuleFrozen,
} from "@studio/song-edit/projectEdit";
import { renamedInstance } from "@studio/song-schema/instanceName";
import { freezeUpstreamRender } from "@studio/take-render/render";
import type { CommandHost, SidHandler } from "../commands.ts";
import { withModuleParams } from "../moduleValues";
import { firstArg, rendererOf, splitWords } from "./shared.ts";

// Where a freeze render lands: one folder for the lot, at the project root — docs/verbs.md.
const FROZEN_DIR = "renders";

// The project's plugin instances by module name: an id is "<chain>:<module>", so take the part after the ':'.
export interface PluginModule {
  module: string;
  id: string;
  type: string;
  track: string;
}

export function collectPluginModules(project: ProjectDoc): PluginModule[] {
  const out: PluginModule[] = [];
  for (const t of project.tracks)
    for (const p of t.plugins) {
      const i = p.id.indexOf(":");
      out.push({
        module: i >= 0 ? p.id.slice(i + 1) : p.id,
        id: p.id,
        type: p.type,
        track: t.id,
      });
    }
  return out;
}

/** `node alternative create|copy` — one shape, one difference. */
async function moduleAltAdd(
  a: string,
  h: CommandHost,
  copy: boolean,
): Promise<void> {
  const verb = copy ? "copy" : "create";
  const [module, name] = splitWords(a);
  if (!module) {
    h.refuse([`usage: node alternative ${verb} <node> [name]`]);
    return;
  }
  try {
    const made = newModuleAlternative(h.songPath, module, name, { copy });
    h.log([
      `${module}: alternative '${made.name}' — ${copy ? "a copy of the one that was on" : "empty, and running"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`node alternative ${verb}: ${(e as Error).message}`]);
  }
}

/** The last segment of a module ref — the namespace is deliberately not part of what a use is NAMED after. */
const moduleLeafOf = (ref: unknown): string | null => {
  const s = typeof ref === "string" ? ref.split("/").pop() : null;
  return s || null;
};

/** Follow a node's name onto the module it now extends, or say why it did not move — docs/verbs.md. */
function renameForNewModule(
  h: CommandHost,
  node: string,
  was: string,
  ref: string,
): string | null {
  const to = moduleLeafOf(ref);
  if (!to) return null;
  const dir = h.songPath;
  const next = renamedInstance(
    node,
    was,
    to,
    laneOfNode(dir, node),
    nodeNameTaken(dir),
  );
  if (!next) return null; // not a name this convention made — somebody chose it
  // A mapping is the one place outside the chains where this name is a REFERENCE, and nothing writes one back.
  const mapped = surfacesNaming(dir, node);
  if (mapped.length)
    return `${node}: kept its name — ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} name it, and a mapping is not rewritten`;
  try {
    const { rewired } = renameChainNode(dir, node, next);
    // A box's member is a reference this CAN write back, unlike a surface mapping above — so it does.
    const boxes = renameNodeInAssemblies(dir, node, next);
    return (
      `${node} → ${next}, following the module it now extends` +
      (rewired.length ? ` (rewired ${rewired.join(", ")})` : "") +
      (boxes.length ? ` (followed in ${boxes.join(", ")})` : "")
    );
  } catch (e) {
    return `${node}: kept its name — ${(e as Error).message}`;
  }
}

export const NODE_VERBS: Record<string, SidHandler> = {
  // The external UI of ONE INSTANCE — the argument names a node, since a module with no instance has no window.
  "node.externalUi": async (a, h) => {
    const name = a.trim();
    // Only an external plugin (VST, AU, CLAP…) has a window of its own; a built-in or a jsdsp one has none.
    const modules = collectPluginModules(h.project()).filter((b) =>
      EXTERNAL_PLUGIN_FORMATS.has(b.type.toLowerCase()),
    );
    if (!name) {
      h.refuse([
        modules.length
          ? `open which? ${modules.map((b) => b.module).join(", ")}`
          : "no external plugins in this project",
      ]);
      return;
    }
    const match =
      modules.find((b) => b.module === name) ??
      modules.find((b) => b.module.toLowerCase() === name.toLowerCase());
    if (!match) {
      h.refuse([
        `no external plugin module '${name}'${modules.length ? ` — try: ${modules.map((b) => b.module).join(", ")}` : ""}`,
      ]);
      return;
    }
    await h.showNativePluginUI(match.id);
    h.log([`opening ${match.module} (${match.type}) on ${match.track}…`]);
  },
  /** `node record save <file> [name]` — send a take FILE, not a node, to the recordings — packages/song/docs/recorderNode.md. */
  "node.record.save": async (a, h) => {
    // The path comes JSON-quoted, since a take's is absolute and on Windows full of backslashes.
    const m = firstArg(a.trim());
    if (!m) {
      h.refuse(["usage: node record save <take-file> [name]"]);
      return;
    }
    const { head: file, rest: label } = m;
    if (!h.saveTake) {
      // Never silent: this host has no médiathèque, a fact about where the command ran, not about the take.
      h.refuse([
        "this surface cannot save a take — it runs nowhere near the recording",
      ]);
      return;
    }
    try {
      const at = await h.saveTake(file, label || undefined);
      h.log([`saved ${at}`]);
    } catch (e) {
      h.refuse([`could not save the take: ${(e as Error).message}`]);
    }
  },
  // `node bypass` writes into graph.yaml's `bypassed` list, not the module file — docs/verbs.md.
  "node.bypass": async (a, h) => {
    const m = /^(\S+)(?:\s+(on|off|true|false))?$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: node bypass <node> [on|off]"]);
      return;
    }
    const [, module, state] = m;
    // graph.yaml alone, not loadGraph — one file instead of 220 ms of compile; docs/verbs.md.
    const allChains = parseChains(
      loadChains(h.songPath, loadProjectRoot(h.songPath, true), true),
    );
    // A module belongs to exactly one chain, so there is no "used in two chains, say which" to answer.
    const hit = Object.entries(allChains).find(([, c]) =>
      c.use.some((s) => s.module === module),
    );
    if (!hit) {
      h.refuse([`no module "${module}" in any chain`]);
      return;
    }
    const [chain, c] = hit;
    // `enabled` defaults to true, so "currently on" is anything but an explicit false.
    const isOn = c.use.find((s) => s.module === module)?.enabled !== false;
    const bypass = state == null ? isOn : state === "on" || state === "true";
    try {
      // `bypass` is already the state wanted, and setModuleBypass takes the state wanted — do not negate it.
      setModuleBypass(h.songPath, module, bypass);
      h.log([`${chain}: ${module} ${bypass ? "bypassed" : "active"}`]);
      // Persist, then push the mutated doc rather than reloading — docs/verbs.md.
      const p = h.project();
      const pluginId = `${chain}:${module}`;
      let found = false;
      const np: ProjectDoc = {
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          plugins: t.plugins.map((pl) => {
            if (pl.id !== pluginId) return pl;
            found = true;
            return { ...pl, enabled: !bypass }; // PluginDoc.enabled means "not bypassed"
          }),
        })),
      };
      // An io module or a dangling step has no plugin to diff, so it falls back to the full reload.
      if (found) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.refuse([`bypass failed: ${(e as Error).message}`]);
    }
  },
  // A module's own fields and its file-valued params are all `node param` — docs/verbs.md.

  /** The three alternative verbs, one operation each on ONE module's file, all ending in a reload; docs/verbs.md. */
  "node.alt.select": async (a, h) => {
    const [module, name] = splitWords(a);
    if (!module) {
      h.refuse(["usage: node alternative select <node> [name]"]);
      return;
    }
    try {
      const { names, current } = moduleAlternatives(h.songPath, module);
      if (!name) {
        // The list is the useful answer to "which ones are there?", so a bare call says it.
        h.log([
          names.length > 1
            ? `${module}: ${names.map((n) => (n === current ? `[${n}]` : n)).join("  ")}`
            : `${module} has one set of settings — 'node alternative create ${module}' starts a second`,
        ]);
        return;
      }
      const { values } = selectModuleAlternative(h.songPath, module, name);
      h.log([`${module}: running alternative '${name}'`]);
      // Two sets differing in numbers alone reach the engine as a diff of the held doc, not a recompile.
      const np =
        values &&
        withModuleParams(h.project(), module, values.params, values.whole);
      if (np) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.refuse([`node alternative: ${(e as Error).message}`]);
    }
  },
  "node.alt.create": (a, h) => moduleAltAdd(a, h, false),
  "node.alt.copy": (a, h) => moduleAltAdd(a, h, true),
  /** Freeze at a module — a TOGGLE; everything upstream is bounced to one wav, packages/song/docs/freeze.md. */
  "node.freeze": async (a, h) => {
    const module = splitWords(a)[0];
    if (!module) {
      h.refuse(["usage: node freeze <node>"]);
      return;
    }
    const g = loadGraph(h.songPath);
    const isLane = (n: string) => !!g.tracks[n];
    const current = g.modules[module]?.frozen;
    if (typeof current === "string" && current) {
      // Unfreeze: the attribute goes and so does the render it pointed at.
      setModuleFrozen(h.songPath, module, null);
      // Only a render INSIDE the project is deleted: `frozen:` is text a file holds (packages/song/docs/confine.md).
      const render = confineTo([h.songPath], join(h.songPath, current));
      if (render) rmSync(render, { force: true });
      h.log([
        `${module}: unfrozen — everything upstream is live again`,
        ...(render ? [] : [`  ${current} is outside the project — left alone`]),
      ]);
      await h.reload();
      return;
    }
    const why = freezeBlockedBy(g.chains, module);
    if (why) {
      h.refuse([`freeze: ${why}`]);
      return;
    }
    const render = `${FROZEN_DIR}/${module.replace(/[:/]/g, "-")}.wav`;
    const plan = freezePlans(g.chains, [[module, render]], isLane)[0];
    // A stopped strudel lane has no clips at all, so the render would be a file of silence — say so.
    const generated = [...plan.lanes].filter(
      (n) => g.tracks[n]?.type === "strudel",
    );
    if (generated.length) {
      h.refuse([
        `freeze: '${generated[0]}' is a strudel lane — its material only exists while it plays, so it can't be baked`,
      ]);
      return;
    }
    const p = h.project();
    // The track the render will play ON, decided by the COMPILER rather than guessed — docs/verbs.md.
    const owner = isLane(module)
      ? module
      : p.tracks.find((t) =>
          t.plugins.some(
            (pl) => pl.id.slice(pl.id.indexOf(":") + 1) === module,
          ),
        )?.id;
    if (!owner) {
      h.refuse([
        `freeze: '${module}' compiles to no plugin, so there is no signal at it to render`,
      ]);
      return;
    }
    const renderer = rendererOf(h);
    if (!renderer) {
      h.refuse(["freeze failed: no engine to render with (build the engine)"]);
      return;
    }
    // Stopped first: a freeze that lands mid-playback swaps a track's contents under a rolling transport.
    await h.transport("stop");
    const out = join(h.songPath, render);
    mkdirSync(dirname(out), { recursive: true });
    try {
      await freezeUpstreamRender(renderer, p, plan, out);
    } catch (e) {
      h.refuse([`freeze failed: ${(e as Error).message}`]);
      return;
    }
    setModuleFrozen(h.songPath, module, render);
    const inside = plan.lanes.size + plan.modules.size - 1;
    h.log([
      `${module}: frozen to ${render}${inside ? ` (${inside} node${inside > 1 ? "s" : ""} upstream baked in)` : ""} — everything downstream stays live`,
    ]);
    await h.reload();
  },
  // No verb deletes a module: its files are the file tree's to remove — docs/verbs.md.

  /** node delete <node> — the node's file, its preset and its place in the graph; the module is untouched. */
  "node.delete": async (a, h) => {
    const node = splitWords(a)[0];
    if (!node) {
      h.refuse(["usage: node delete <node>"]);
      return;
    }
    try {
      const { rewired, removed } = deleteChainNode(h.songPath, node);
      // …and out of any box holding it, which loses its record once it has no members left.
      dropNodeFromAssemblies(h.songPath, node);
      h.log([
        `deleted ${removed.join(", ")}` +
          (rewired.length
            ? ` — rejoined what fed it: ${rewired.join(", ")}`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node delete failed: ${(e as Error).message}`]);
    }
  },
  /** node replace <node> <extends-ref> — ONE edit to the node's `extends`, then its NAME follows; docs/verbs.md. */
  "node.replace": async (a, h) => {
    const usage = "usage: node replace <node> <extends-ref>";
    const [key, ref] = splitWords(a);
    if (!key || !ref) {
      h.refuse([usage]);
      return;
    }
    try {
      // What it extended BEFORE, read first because `setModuleExtends` is about to overwrite it.
      const was = moduleLeafOf(loadModules(h.songPath)[key]?.extends);
      const { rel, dropped, alternative } = setModuleExtends(
        h.songPath,
        key,
        ref,
      );
      h.log([
        `${key}${alternative ? `, alternative '${alternative}'` : ""}: extends ${ref} (${rel})` +
          (dropped.length ? ` — dropped its own ${dropped.join(", ")}` : ""),
      ]);
      // A SET repointed leaves the node's name alone: it names every set, and the first is still the old module.
      const renamed =
        was && !alternative ? renameForNewModule(h, key, was, ref) : null;
      await h.reload();
      if (renamed) h.log([renamed]);
    } catch (e) {
      h.refuse([`node replace failed: ${(e as Error).message}`]);
    }
  },
};
