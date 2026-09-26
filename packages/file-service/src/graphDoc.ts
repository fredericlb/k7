// graphDoc.ts — compile the active project's routing graph into the WebGraph the
// Chains tab draws. A pure function of the project dir (loadGraph + loadCurves + the
// plugin scan cache), and outside `Workspace` because it reads no instance state.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isPluginScanned } from "@studio/engine-client/pluginCache";
import type {
  WebChainStep,
  WebGraph,
  WebNodeAssembly,
  WebRackSound,
} from "@studio/graph-model";
import type { AutoFreeze } from "@studio/song/autoFreeze";
import { moduleBaseChoices } from "@studio/song/basePreset";
import { loadCurves } from "@studio/song/curves";
import { activeFreezePlans } from "@studio/song/freeze";
import type { Rack } from "@studio/song/graph";
import { inputLandingTrack, loadGraph } from "@studio/song/graph";
import { missingModel } from "@studio/song/modelCache";
import {
  type AssetLookup,
  assetLookup,
  moduleAssetChoices,
} from "@studio/song/moduleAssetChoices";
import {
  EXTERNAL_PLUGIN_FORMATS,
  FAUST_TYPE,
  JSDSP_TYPE,
  MIXER_PLUGIN,
  OFFLINE_TYPE,
} from "@studio/song/project";
import {
  CAMERA_IO,
  curveIdFromRef,
  hostsPlugin,
  SHADER_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { moduleShaderChoices } from "@studio/song-video/shaders";

// The formats with a native editor, re-exported rather than restated — see docs/graphFlags.md.
export { EXTERNAL_PLUGIN_FORMATS };

/** The assets a module may name — its own and its ancestors'. See docs/graphFlags.md. */
function assetChoicesFor(
  dir: string,
  module: { category?: string; file?: string; extends?: string } | undefined,
  refs: Readonly<Record<string, { extends?: unknown }>>,
  lookup: AssetLookup,
): string[] | undefined {
  try {
    const files = moduleAssetChoices(dir, module, refs, lookup);
    return files.length ? files : undefined;
  } catch {
    return undefined;
  }
}

/** The named bases a module may be set to — its own `base/` and its ancestors'. See docs/graphFlags.md. */
function baseChoicesFor(
  module: { extends?: unknown; folderAbs?: unknown } | undefined,
  refs: Readonly<Record<string, { extends?: unknown; folderAbs?: unknown }>>,
): string[] | undefined {
  try {
    const names = moduleBaseChoices(module, refs);
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** …and the shaders a `shaders` module carries, its ancestors' included — packages/song-video/docs/shaders.md. */
function shaderChoicesFor(
  dir: string,
  module:
    | {
        category?: unknown;
        file?: unknown;
        extends?: unknown;
        folderAbs?: unknown;
      }
    | undefined,
  refs: Readonly<Record<string, { extends?: unknown; folderAbs?: unknown }>>,
): string[] | undefined {
  if (module?.category !== SHADER_CATEGORY) return undefined;
  try {
    const names = moduleShaderChoices(dir, module, refs);
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** An input's channels when the file states them as NUMBERS, else undefined — docs/graphFlags.md. */
function numericChannels(channel: unknown): number[] | undefined {
  if (!Array.isArray(channel)) return undefined;
  const ns = channel
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ns.length ? ns : undefined;
}

/** A rack's sounds, flattened for the pads its node draws — packages/song/docs/racks.md. */
function rackSounds(
  module: { rack?: Rack } | undefined,
): WebRackSound[] | undefined {
  const rack = module?.rack;
  if (!rack) return undefined;
  const out = Object.entries(rack.symbols)
    .map(([symbol, s]) => ({
      symbol,
      note: Number(s?.note ?? 0),
      ...(rack.rackType === "slice"
        ? {
            ...(rack.source ? { source: rack.source } : {}),
            ...(s?.from != null ? { from: Number(s.from) } : {}),
            ...(s?.to != null ? { to: Number(s.to) } : {}),
          }
        : { ...(s?.clip ? { clip: String(s.clip) } : {}) }),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  // No pads rather than an empty row, so a rack nobody has filled keeps the size it had.
  return out.length ? out : undefined;
}

// Beats drawn for a clip whose compiled `length` is 0 — the timeline's number too, docs/graphFlags.md.
const NATURAL_BEATS = 4;

/** Where each track's clips START and how long they RUN — handed in, not compiled, docs/graphFlags.md. */
export type ClipExtents = Record<string, { start: number; length: number }[]>;

/** The extents of a compiled project, keyed by track — what `buildGraphDoc` takes. */
export function clipExtentsOf(doc: {
  tracks: { id: string; clips: { start: number; length: number }[] }[];
}): ClipExtents {
  const out: ClipExtents = {};
  for (const t of doc.tracks)
    if (t.clips.length)
      out[t.id] = t.clips.map((c) => ({ start: c.start, length: c.length }));
  return out;
}

/** Which node is each track's FADER, by track id — handed in like the extents, and for the same reason. */
export type TrackMixers = Record<string, string>;

/**
 * The `Mixer` at the end of each track's chain, from the COMPILED project: `graph.yaml` alone says
 * what a module is wired to, not what plugin it turns out to be, and the strip is defined by its type.
 */
export function trackMixersOf(doc: {
  tracks: { id: string; plugins: { type: string; name: string }[] }[];
}): TrackMixers {
  const out: TrackMixers = {};
  for (const t of doc.tracks) {
    // The LAST one, as `trackMixer` reads it: a chain may pass through more than one and the level lives on the last.
    for (let i = t.plugins.length - 1; i >= 0; i--)
      if (t.plugins[i].type === MIXER_PLUGIN) {
        out[t.id] = t.plugins[i].name;
        break;
      }
  }
  return out;
}

export function buildGraphDoc(
  dir: string,
  extents?: ClipExtents,
  mixers?: TrackMixers,
  /** The project's automatic freezes, from the caller's memo of the compile — none drawn when absent. */
  autoFreezes?: AutoFreeze[],
): WebGraph {
  // loadGraph reads graph.yaml exactly as the compile does.
  const g = loadGraph(dir);
  // Curve shapes for automation node labels, narrowed below to the curves a module actually binds.
  const allCurves = (() => {
    try {
      return loadCurves(dir);
    } catch {
      return {}; // a broken curve file shouldn't take the whole graph down
    }
  })();
  // The `extends` vocabulary off the graph, which has already read it — see docs/graphFlags.md.
  const moduleRefs = g.moduleRefs;
  // …and the `assets/` listings, memoised for this whole build because ancestors repeat.
  const assets = assetLookup();
  const usedCurves: WebGraph["curves"] = {};
  const chains: WebGraph["chains"] = {};
  for (const [name, c] of Object.entries(g.chains))
    chains[name] = {
      from: c.from,
      // Which of the lane's outputs this run left by, when the lane wired both.
      ...(c.fromPort ? { fromPort: c.fromPort } : {}),
      use: c.use.map((s) => {
        // Already RESOLVED by buildGraph, so every read below is the module's own — moduleResolve.ts.
        const module = g.modules[s.module];
        const plugin = module?.plugin;
        const isPlugin = module?.kind === "plugin";
        // …but a shader, a shape and a transition ARE their behaviour, so there is no plugin SLOT
        // on one and an absent `plugin:` is not a hole — see docs/graphFlags.md.
        const slot = isPlugin && hostsPlugin(module?.category);
        const type = module?.type ?? "plugin";
        const fmt = plugin?.type ? String(plugin.type).toLowerCase() : "";
        // A stub is a plugin slot with no plugin — not a rack, which legitimately carries a sampler instead.
        const stub = slot && type !== "rack" && !plugin;
        // A plugin st0 can't load: "not_supported" (amber) or unknown to the engine (red). See docs/graphFlags.md.
        const known =
          fmt === "internal" ||
          fmt === JSDSP_TYPE ||
          fmt === FAUST_TYPE ||
          fmt === OFFLINE_TYPE ||
          EXTERNAL_PLUGIN_FORMATS.has(fmt);
        const notSupported = slot && fmt === "not_supported";
        const unscanned =
          slot &&
          EXTERNAL_PLUGIN_FORMATS.has(fmt) &&
          !isPluginScanned(fmt, String(plugin?.name ?? ""));
        const unknownPlugin =
          slot && !!plugin && !notSupported && (!known || unscanned);
        // Keep only automations whose curve exists; record each referenced curve's shape so the graph can label its node.
        // The authored `curve:` is a `@meta/curves/<id>` ref — bare id from here on, same as `allCurves`'s own keys.
        const automations = (module?.automations ?? [])
          .map((a) => ({ ...a, curve: curveIdFromRef(a.curve) }))
          .filter((a) => {
            const cv = allCurves[a.curve];
            if (!cv) return false;
            usedCurves[a.curve] = {
              type: cv.type,
              shape: cv.type === "lfo" ? cv.shape : undefined,
              // A drawn curve's points travel; a parameterised one's do not. See WebCurve.points.
              points: cv.type === "custom" ? cv.points : undefined,
            };
            return true;
          });
        // A model named and not here, with somewhere to fetch it from: what the node's right-click offers.
        const needs = module ? missingModel(module) : null;
        return {
          module: s.module,
          // …and WHICH module it is a use of — the authored `extends`, see docs/graphFlags.md.
          ...(module?.extends ? { uses: String(module.extends) } : {}),
          ...(needs?.url
            ? { modelDownload: { file: needs.file, url: needs.url } }
            : {}),
          // Everything below already reads `undefined` off a missing module; this flag is what lets the graph SAY so.
          missing: module ? undefined : true,
          // Only past one: a single flow input is what every node already draws.
          inputs:
            module && module.inputs.length > 1
              ? module.inputs.map((i) => ({
                  name: i.name,
                  type: i.type,
                  // Only when false: absent means mandatory on both sides, so the common port costs no field.
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
          // …and what it may choose from: the module's OWN assets/, walked — docs/graphFlags.md.
          assetChoices: assetChoicesFor(dir, module, moduleRefs, assets),
          // Which base this module is on (the MODULE's own field) and the ones it could be on (the folder's).
          base:
            typeof module?.base === "string" && module.base
              ? module.base
              : undefined,
          bases: baseChoicesFor(module, moduleRefs),
          // …and the same pair for a SHADER node, which only a `shaders` module answers at all.
          shader:
            typeof module?.shader === "string" && module.shader
              ? module.shader
              : undefined,
          shaders: shaderChoicesFor(dir, module, moduleRefs),
          // The EVENTS this module announces, read off its TYPE FOLDER — see docs/graphFlags.md.
          events: module?.category === "instruments" ? ["note-on"] : undefined,
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
            slot &&
            !!plugin &&
            !notSupported &&
            !unknownPlugin &&
            EXTERNAL_PLUGIN_FORMATS.has(fmt),
          ui: module?.ui,
          // A RACK's loaded sounds, the EFFECTIVE rack, so its node can draw a pad per sound.
          rack: rackSounds(module),
          // Which CC plays which param, from `controller.yaml`, keyed like `ui` — docs/graphFlags.md.
          cc: module?.cc,
          // The other attribute sets this module could be switched to — packages/song/docs/alternatives.md.
          alternatives: module?.alternatives,
          alternative: module?.alternative,
          params: module?.params ?? {},
          // The engine's address, ONLY when the engine will really have one — see docs/graphFlags.md.
          pluginId:
            slot &&
            !stub &&
            !notSupported &&
            !unknownPlugin &&
            fmt !== OFFLINE_TYPE
              ? `${name}:${s.module}`
              : undefined,
          // A live input's own field, not a param: there is no plugin, so it is the module's.
          monitor: module?.io === "in" ? (module.monitor ?? "auto") : undefined,
          // …and which socket it is on, NUMBERS only — a preferences label stays absent, docs/graphFlags.md.
          channel:
            module?.io === "in" ? numericChannels(module.channel) : undefined,
          // A CAMERA's own field, on the same terms — and PRESENT even when empty, since that is
          // what tells the card it is a lens at all: "" is the default one (docs/camera.md).
          camera: module?.io === CAMERA_IO ? (module.camera ?? "") : undefined,
          automations: automations.length ? automations : undefined,
        };
      }),
      enabled: c.enabled,
      // `fromPort` only when there is one, so the wire stays plain for every chain drawn without one.
      out: c.out.map((o) => ({
        to: o.to,
        gain: o.gain,
        ...(o.fromPort ? { fromPort: o.fromPort } : {}),
      })),
    };

  // Where each live input's waveform listens — a second pass over the built steps, docs/graphFlags.md.
  const isTrack = (id: string) => !!g.tracks[id];
  for (const [name, c] of Object.entries(g.chains)) {
    const track = inputLandingTrack(c, isTrack);
    if (!track) continue;
    const id = chains[track]?.use.find((s) => s.pluginId)?.pluginId;
    if (!id) continue; // the lane runs no plugins — nothing to listen to
    for (const s of chains[name].use)
      if (g.modules[s.module]?.io === "in") s.tap = { id, side: "input" };
  }
  // A note's TEXT, keyed by DOC modules and nothing else — see docs/graphFlags.md.
  const modules: WebGraph["modules"] = {};
  for (const [name, m] of Object.entries(g.modules))
    if (m.kind === "doc") modules[name] = { content: m.content ?? "" };
  const trackColors: Record<string, string> = {};
  // What a track puts on the wire: a sequences track feeds MIDI to the chain's instrument, an audio one audio.
  const trackSignals: WebGraph["trackSignals"] = {};
  // What is baked, by node name, from the compiler's own question — packages/song/docs/freeze.md.
  const frozen: NonNullable<WebGraph["frozen"]> = {};
  for (const p of activeFreezePlans(
    g.chains,
    g.modules,
    (n) => !!g.tracks[n],
    (r) => existsSync(resolve(dir, r)),
  )) {
    for (const n of [...p.lanes, ...p.modules]) frozen[n] = "inside";
    frozen[p.at] = "at";
  }
  // …and what an automatic freeze bakes, each node naming the VST whose render holds it — packages/song/docs/autoFreeze.md.
  const autoFrozen: NonNullable<WebGraph["autoFrozen"]> = {};
  for (const f of autoFreezes ?? [])
    if (f.ready)
      for (const n of [...f.plan.lanes, ...f.plan.modules])
        autoFrozen[n] = f.module;
  // A lane's other attribute sets, from the module it IS — only past one, docs/graphFlags.md.
  const trackAlternatives: NonNullable<WebGraph["trackAlternatives"]> = {};
  // The song's meter, for spelling a clip's position: a header that says nothing is 4/4.
  const [sigNum, sigDen] = (() => {
    const m = /^(\d+)\/(\d+)$/.exec(g.project.timeSignature ?? "");
    return m ? [Number(m[1]), Number(m[2])] : [4, 4];
  })();
  // What each lane HOLDS, sorted by position rather than by authored order — docs/graphFlags.md.
  const trackClips: NonNullable<WebGraph["trackClips"]> = {};
  for (const [id, t] of Object.entries(g.tracks)) {
    if (t.color) trackColors[id] = t.color;
    // What the lane puts on a wire when a run leaves it BARE — see docs/graphFlags.md.
    trackSignals[id] =
      t.placements.length && t.placements.every((p) => p.kind === "midi")
        ? "midi"
        : "audio";
    const lane = g.modules[id];
    if (lane?.alternatives && lane.alternative)
      trackAlternatives[id] = {
        alternatives: lane.alternatives,
        alternative: lane.alternative,
      };
    // Only what a lane really holds: a group and a strudel lane both carry an empty `placements`.
    if (t.placements.length) {
      // The compiled extents of THIS lane, matched to a placement by `start` — docs/graphFlags.md.
      const byStart = new Map(
        (extents?.[id] ?? []).map((c) => [c.start, c.length]),
      );
      trackClips[id] = [...t.placements]
        .sort((a, b) => a.start - b.start)
        .map((p) => {
          const compiled = byStart.get(p.start);
          return {
            ref: p.ref,
            start: p.start,
            tc: beatsToPosition(p.start, sigNum, sigDen),
            // Absent when the project would not compile — the graph still draws, without widths.
            ...(compiled === undefined
              ? {}
              : { len: compiled > 0 ? compiled : NATURAL_BEATS }),
            kind: p.kind,
          };
        });
    }
  }
  // The boxes. Already resolved onto this project's node names by `@studio/song`; what is added
  // here is the engine ADDRESS of each promoted param, which only the compiled steps know.
  const pluginIds = new Map<string, string>();
  for (const c of Object.values(chains))
    for (const step of c.use)
      if (step.pluginId) pluginIds.set(step.module, step.pluginId);
  const assemblies: NonNullable<WebGraph["assemblies"]> = {};
  for (const [id, a] of Object.entries(g.assemblies)) {
    const params: NonNullable<WebNodeAssembly["params"]> = {};
    for (const [name, t] of Object.entries(a.params))
      params[name] = {
        ...t,
        ...(pluginIds.has(t.node) ? { pluginId: pluginIds.get(t.node) } : {}),
      };
    assemblies[id] = {
      uses: a.uses,
      label: a.label,
      // In the TEMPLATE's declaration order, which is the order its own graph is written in.
      members: Object.values(a.members),
      ...(a.inputs.length ? { inputs: a.inputs } : {}),
      ...(a.outputs.length ? { outputs: a.outputs } : {}),
      ...(Object.keys(params).length ? { params } : {}),
      ...(a.missing ? { missing: true } : {}),
    };
  }

  return {
    chains,
    tracks: Object.keys(g.tracks),
    ...(g.positions ? { positions: g.positions } : {}),
    videoTracks: Object.keys(g.videoTracks),
    trackColors,
    trackSignals,
    // Only the lanes this graph really draws: a mixer named for a track the file no longer has is a card nobody would find.
    ...(mixers && Object.keys(mixers).length
      ? {
          trackMixers: Object.fromEntries(
            Object.entries(mixers).filter(([id]) => id in g.tracks),
          ),
        }
      : {}),
    ...(Object.keys(trackClips).length ? { trackClips } : {}),
    ...(Object.keys(trackAlternatives).length ? { trackAlternatives } : {}),
    ...(Object.keys(frozen).length ? { frozen } : {}),
    ...(Object.keys(autoFrozen).length ? { autoFrozen } : {}),
    ...(Object.keys(assemblies).length ? { assemblies } : {}),
    modules,
    // EVERY curve the project has, not only the bound ones — see docs/graphFlags.md.
    curves: (() => {
      const all: WebGraph["curves"] = { ...usedCurves };
      for (const [id, cv] of Object.entries(allCurves))
        if (!all[id])
          all[id] = {
            type: cv.type,
            shape: cv.type === "lfo" ? cv.shape : undefined,
            points: cv.type === "custom" ? cv.points : undefined,
          };
      return Object.keys(all).length ? all : undefined;
    })(),
    warnings: g.warnings,
  };
}
