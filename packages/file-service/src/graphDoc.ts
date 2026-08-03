// graphDoc.ts — compile the active project's routing graph into the WebGraph the
// Chains tab draws. A pure function of the project dir (loadGraph + loadCurves + the
// plugin scan cache); extracted from workspace.ts, where it was the class's largest
// method with no instance state at all.

import { isPluginScanned } from "@studio/engine-client/pluginCache";
import type { WebChainStep, WebGraph } from "@studio/graph-model";
import { loadCurves } from "@studio/song/curves";
import { inputLandingTrack, loadGraph } from "@studio/song/graph";
import { listLibrary, listLibraryKinds } from "@studio/song/loader";
import { EXTERNAL_PLUGIN_FORMATS } from "@studio/song/project";

// The formats with a native editor the engine can open. Re-exported, not restated: it
// was declared here a second time, identically, and docs/loader.md's list of copies to
// keep in step did not even mention this one.
export { EXTERNAL_PLUGIN_FORMATS };

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
        // A plugin pistes can't load: "not_supported" (amber) or unknown to the engine (red). See docs/graphFlags.md.
        const known = fmt === "internal" || EXTERNAL_PLUGIN_FORMATS.has(fmt);
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
          // As authored (inherited like params), so a library dropdown can show what's loaded without asking the engine.
          assets: module?.assets,
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
      out: c.out.map((o) => ({ to: o.to, gain: o.gain })),
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
    // An unreadable library is an empty one — it must not take the graph down.
    libraryFiles: (() => {
      try {
        return listLibraryKinds(dir).flatMap((k) => listLibrary(dir, k));
      } catch {
        return [];
      }
    })(),
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
