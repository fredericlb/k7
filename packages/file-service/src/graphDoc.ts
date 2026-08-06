// graphDoc.ts — compile the active project's routing graph into the WebGraph the
// Chains tab draws. A pure function of the project dir (loadGraph + loadCurves + the
// plugin scan cache); extracted from workspace.ts, where it was the class's largest
// method with no instance state at all.

import { join } from "node:path";
import { isPluginScanned } from "@studio/engine-client/pluginCache";
import type { WebChainStep, WebGraph } from "@studio/graph-model";
import { loadCurves } from "@studio/song/curves";
import { inputLandingTrack, loadGraph } from "@studio/song/graph";
import { listModuleAssets } from "@studio/song/loader";
import {
  EXTERNAL_PLUGIN_FORMATS,
  JSDSP_TYPE,
  OFFLINE_TYPE,
} from "@studio/song/project";

// The formats with a native editor the engine can open. Re-exported, not restated: it
// was declared here a second time, identically, and docs/loader.md's list of copies to
// keep in step did not even mention this one.
export { EXTERNAL_PLUGIN_FORMATS };

/** A module's own `assets/`, or nothing — for a module with no folder of its own (one the
 *  engine provides, named by a chain with no local file), there is nothing to list. */
function assetChoicesFor(
  dir: string,
  module: { category?: string; file?: string } | undefined,
): string[] | undefined {
  if (!module?.category || !module?.file) return undefined;
  try {
    const files = listModuleAssets(
      join(dir, "modules", String(module.category), String(module.file)),
    );
    return files.length ? files : undefined;
  } catch {
    return undefined;
  }
}

export function buildGraphDoc(dir: string): WebGraph {
  // loadGraph reads chains.yaml exactly as the compile does.
  const g = loadGraph(dir);
  // Curve shapes for automation node labels, narrowed below to the curves a module actually binds.
  const allCurves = (() => {
    try {
      return loadCurves(dir);
    } catch {
      return {}; // a broken curve file shouldn't take the whole graph down
    }
  })();
  const usedCurves: WebGraph["curves"] = {};
  const chains: WebGraph["chains"] = {};
  for (const [name, c] of Object.entries(g.chains))
    chains[name] = {
      from: c.from,
      use: c.use.map((s) => {
        // Already RESOLVED by buildGraph — what it extends is folded in, so every read
        // below is the module's own. See moduleResolve.ts.
        const module = g.modules[s.module];
        const plugin = module?.plugin;
        const isPlugin = module?.kind === "plugin";
        const type = module?.type ?? "plugin";
        const fmt = plugin?.type ? String(plugin.type).toLowerCase() : "";
        // A stub is a plugin slot with no plugin — not a rack, which legitimately carries a sampler instead.
        const stub = isPlugin && type !== "rack" && !plugin;
        // A plugin l8 can't load: "not_supported" (amber) or unknown to the engine (red). See docs/graphFlags.md.
        //
        // `jsdsp` is known: the engine loads its built-in graph host and is handed the graph
        // (see enginePlugin). Missing here it cost the node BOTH its colour and its values —
        // red, and no `pluginId`, which is the address the panel asks the engine for a
        // parameter by. A module that plays perfectly drew as one that could not load.
        // `offline` is known for the same reason `jsdsp` is: the compiler recognises it, so a
        // node drawn red — the colour for "the engine cannot load this" — would be a lie about a
        // module that is working exactly as written. It loads nothing BY DESIGN.
        const known =
          fmt === "internal" ||
          fmt === JSDSP_TYPE ||
          fmt === OFFLINE_TYPE ||
          EXTERNAL_PLUGIN_FORMATS.has(fmt);
        const notSupported = isPlugin && fmt === "not_supported";
        const unscanned =
          isPlugin &&
          EXTERNAL_PLUGIN_FORMATS.has(fmt) &&
          !isPluginScanned(fmt, String(plugin?.name ?? ""));
        const unknownPlugin =
          isPlugin && !!plugin && !notSupported && (!known || unscanned);
        // Keep only automations whose curve exists; record each referenced curve's shape so the graph can label its node.
        const automations = (module?.automations ?? []).filter((a) => {
          const cv = allCurves[a.curve];
          if (!cv) return false;
          usedCurves[a.curve] = {
            type: cv.type,
            shape: cv.type === "lfo" ? cv.shape : undefined,
          };
          return true;
        });
        return {
          module: s.module,
          // Everything below already reads `undefined` off a missing module; this flag is what lets the graph SAY so.
          missing: module ? undefined : true,
          // Only when there is more than one: a single flow input is what every node already
          // draws, and sending the list for all of them would put a field on every step to say
          // what its absence already says.
          inputs:
            module && module.inputs.length > 1
              ? module.inputs.map((i) => ({
                  name: i.name,
                  type: i.type,
                  // Only when false: absent means mandatory on both sides, so the common port
                  // costs no field. It is what decides whether a socket shows before it is fed.
                  ...(i.mandatory === false ? { mandatory: false } : {}),
                }))
              : undefined,
          // The outputs, on the same "only when there is more than one" terms.
          outputs:
            module && module.outputs.length > 1
              ? module.outputs.map((o) => ({ name: o.name, type: o.type }))
              : undefined,
          // As authored (inherited like params), so an asset dropdown can show what's loaded without asking the engine.
          assets: module?.assets,
          // …and what it may choose from: the module's OWN assets/, walked. Per module rather
          // than once for the graph, because there is no shared library any more — the choices
          // ARE the folder's contents. An unreadable folder is an empty one, never a failure.
          assetChoices: assetChoicesFor(dir, module),
          // Its type folder — the node's icon. From the module itself, never its base: a kind comes from where IT lives.
          category: module?.category as WebChainStep["category"],
          // What leaves this module — the colour of the cable to the next one.
          emits: module?.emits,
          enabled: s.enabled,
          stub,
          notSupported: notSupported || undefined,
          unknownPlugin: unknownPlugin || undefined,
          // Only an instantiable plugin has a native editor window to open — distinct from `ui`, the moduleUI widget grid.
          hasNativePluginUI:
            isPlugin &&
            !!plugin &&
            !notSupported &&
            !unknownPlugin &&
            EXTERNAL_PLUGIN_FORMATS.has(fmt),
          ui: module?.ui,
          // Which CC plays which param, from the module folder's `controller.yaml`. Rides beside
          // `ui` because it is keyed the same way — by the widget's `bind` — and read in the same
          // place: the graph is where a knob is drawn, so it is where a knob learns its control.
          cc: module?.cc,
          params: module?.params ?? {},
          pluginId:
            isPlugin && !stub && !notSupported && !unknownPlugin
              ? `${name}:${s.module}`
              : undefined,
          // A live input's own field, so a widget can show and set it. Not a param: it is
          // not the plugin's (there is no plugin), it is the module's.
          monitor: module?.io === "in" ? (module.monitor ?? "auto") : undefined,
          automations: automations.length ? automations : undefined,
        };
      }),
      enabled: c.enabled,
      // `fromPort` only when there is one: a module with the single output most have says
      // nothing, and the wire stays what it was for every chain drawn before.
      out: c.out.map((o) => ({
        to: o.to,
        gain: o.gain,
        ...(o.fromPort ? { fromPort: o.fromPort } : {}),
      })),
    };

  /**
   * Where each live input's waveform listens.
   *
   * An input carries no plugin, so there is nothing ON it to tap; the signal it sends arrives at the INPUT of
   * the first module on the lane it feeds — the same audio, one step downstream, and the only place the engine
   * can be asked for it without a new kind of tap. Being the lane's input it also carries whatever clips the
   * lane plays, which while overdubbing is what you wanted to see anyway.
   *
   * A second pass, over the built steps rather than the model: the id has to be one the engine really has, and
   * the only thing that knows which steps earned a `pluginId` is the loop that just assigned them.
   */
  const isTrack = (id: string) => !!g.tracks[id];
  for (const [name, c] of Object.entries(g.chains)) {
    const track = inputLandingTrack(c, isTrack);
    if (!track) continue;
    const id = chains[track]?.use.find((s) => s.pluginId)?.pluginId;
    if (!id) continue; // the lane runs no plugins — nothing to listen to
    for (const s of chains[name].use)
      if (g.modules[s.module]?.io === "in") s.tap = { id, side: "input" };
  }
  const modules: WebGraph["modules"] = {};
  for (const [name, m] of Object.entries(g.modules))
    modules[name] = { docs: m.docs, todos: m.todos };
  const trackColors: Record<string, string> = {};
  // What a track puts on the wire: a sequences track feeds MIDI to the chain's instrument, an audio one audio.
  const trackSignals: WebGraph["trackSignals"] = {};
  // loadGraph has already cleared `frozen` on any track whose render went missing, so this is the state the
  // compiled doc will agree with rather than what the yaml claims.
  const frozenTracks: string[] = [];
  for (const [id, t] of Object.entries(g.tracks)) {
    if (t.color) trackColors[id] = t.color;
    trackSignals[id] = t.contentType === "sequences" ? "midi" : "audio";
    if (t.frozen) frozenTracks.push(id);
  }
  return {
    chains,
    tracks: Object.keys(g.tracks),
    videoTracks: Object.keys(g.videoTracks),
    trackColors,
    trackSignals,
    ...(frozenTracks.length ? { frozenTracks } : {}),
    modules,
    curves: Object.keys(usedCurves).length ? usedCurves : undefined,
    warnings: g.warnings,
  };
}
