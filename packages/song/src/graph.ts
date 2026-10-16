// graph.ts — load a node/track/chain project into the GraphDoc a surface draws: clips and sequences are
// the material, tracks arrange them, modules wrap a plugin or rack, and chains route a track through modules to
// the OUT sink. Chains are DERIVED from graph.yaml's segments (chainsGraph.ts). See docs/nodeProjectLayout.md.
// The model, its validation and its text form are graphTypes, graphValidate and graphDescribe, re-exported here.

import {
  alternativesOf,
  currentAlternative,
} from "@studio/song-schema/alternatives";
import { currentEngine, engineNames } from "@studio/song-schema/engines";
import { curveIdFromRef } from "@studio/song-schema/moduleTypes";
import { parsePosition } from "@studio/song-schema/timecode";
import { type Assembly, resolveAssemblies } from "./assemblies";
import { loadLinkLevels } from "./chainProject";
import { bypassedOf, deriveChains } from "./chainsGraph";
import {
  type Automation,
  type Chain,
  type GraphDoc,
  type InstrumentType,
  isInputModule,
  isSink,
  kitOf,
  type Module,
  normalizeInputs,
  normalizeOutputs,
  type Placement,
  type Track,
  type VideoTrack,
} from "./graphTypes";
import { checkChainInputs, validate } from "./graphValidate";
import { applyLinkLevels, unplayedLevels } from "./linkLevels";
import {
  exportSub,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
  moduleEmits,
  withChainModuleRefs,
} from "./loader";
import { withModuleStamp } from "./moduleCache";
import {
  type ResolvedModule,
  resolvedCc,
  resolvedRack,
  resolvedType,
  resolvedUI,
  resolveModule,
  resolveModuleMap,
} from "./moduleResolve";
import { monitorMode } from "./monitorMode";
import { loadPreferences, type Preferences, resolveInput } from "./preferences";
import type {
  LoadedModule,
  RawClip,
  RawProjectRoot,
  RawSequence,
  RawVideoTrack,
} from "./rawDoc";
import { tapFeedsOf } from "./tapOuts";
import { lanesOf } from "./trackModule";

export {
  describeGraph,
  describeTrackGraph,
  resolveTrack,
} from "./graphDescribe";

export {
  type Automation,
  type Chain,
  carriesCamera,
  carriesFileInput,
  carriesMidiIn,
  carriesShape,
  coldPlacementError,
  type GraphDoc,
  type InputDef,
  type InstrumentType,
  inputLandingTrack,
  isCameraModule,
  isColdModule,
  isFileInputModule,
  isInputModule,
  isMidiInModule,
  isShapeModule,
  isStretch,
  type Module,
  type ModuleUI,
  type Out,
  type OutputDef,
  type Placement,
  type Rack,
  type RackSound,
  type RackType,
  type Step,
  type Track,
  type UiTab,
  type VideoTrack,
  type Widget,
  type WidgetType,
} from "./graphTypes";

export {
  checkChainInputs,
  validate,
} from "./graphValidate";
// Where an unnamed node sits, for whatever SHOWS one — this package exports no chainProject subpath.
export {
  type NodePlace,
  nodeCaption,
  nodePlaces,
  nodeStacks,
  placeOf,
} from "./nodePlace";

// The chains, derived from the file's segments (chainsGraph.ts), re-exported under the name every consumer already calls.
export const parseChains = deriveChains;

// --- building the doc (pure; no fs) -----------------------------------------

// A declared `input`, normalised but NOT resolved: a label stays a label, and this only has to survive a hand-edit mid-save.
function normInput(v: unknown): string | number[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const ch = v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ch.length ? ch : undefined;
  }
  const s = String(v);
  return s ? s : undefined;
}

// A module's `automations` list, coerced: an entry missing a param or a curve is dropped rather than carried half-bound.
function normAutomations(v: unknown): Automation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Automation[] = [];
  for (const a of v as { param?: unknown; curve?: unknown }[]) {
    const param = typeof a?.param === "string" ? a.param : "";
    const curve = typeof a?.curve === "string" ? curveIdFromRef(a.curve) : "";
    if (param && curve) out.push({ param, curve });
  }
  return out.length ? out : undefined;
}

export function buildGraph(
  root: RawProjectRoot,
  chainsMap: unknown,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
  modulesMap: Record<string, LoadedModule>,
  moduleRefsMap: Record<string, LoadedModule>,
  videoTracksMap: Record<string, RawVideoTrack> = {},
  // Resolved by the fs side (assemblies.ts), so this function stays pure like everything else here.
  assembliesMap: Record<string, Assembly> = {},
): GraphDoc {
  const ts = String(root?.project?.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  const pos = (tc: unknown) =>
    tc != null && tc !== "" ? parsePosition(String(tc), num || 4, den || 4) : 0;

  // The authored instrument type, if one of the known values, else undefined so it falls back to "plugin".
  const normType = (v: unknown): InstrumentType | undefined =>
    v === "rack" || v === "plugin" ? v : undefined;
  // One module normalizer for both maps, handed a RESOLVED module — inheritance is already settled.
  const toModule = (b: ResolvedModule): Module => ({
    extends: b?.extends ? String(b.extends) : undefined,
    // Four kinds, read straight rather than folded to "not io means plugin", which is what made a note compile as one.
    kind:
      b?.kind === "io" || b?.kind === "doc" || b?.kind === "track"
        ? b.kind
        : "plugin",
    io: b?.io ? String(b.io) : undefined,
    plugin: b?.plugin,
    type: normType(b?.type),
    params: b?.params ?? {},
    // Inherited like `plugin`, so a use of a cold module is cold and nothing has to restate it.
    cold: b?.cold === true ? true : undefined,
    mix: typeof b?.mix === "number" ? b.mix : undefined,
    input_volume:
      typeof b?.input_volume === "number" ? b.input_volume : undefined,
    output_volume:
      typeof b?.output_volume === "number" ? b.output_volume : undefined,
    // WHICH lens an io camera opens, inherited the same way — see docs/camera.md.
    camera: typeof b?.camera === "string" ? b.camera : undefined,
    // …and WHICH MIDI device an io midi records from — see docs/midiIn.md.
    device: typeof b?.device === "string" ? b.device : undefined,
    // …and its rectangle in the viewport, four numbers or nothing at all.
    frame:
      Array.isArray(b?.frame) && b.frame.length === 4
        ? b.frame.map(Number)
        : undefined,
    // Which SHADER a shader node runs, inherited like `plugin` — see packages/song-video/docs/shaders.md.
    shader: typeof b?.shader === "string" && b.shader ? b.shader : undefined,
    lut: typeof b?.lut === "string" && b.lut ? b.lut : undefined,
    // The shape a `shapes` module draws, and how it is painted — inherited like `plugin` (docs/shapes.md).
    shape: typeof b?.shape === "string" && b.shape ? b.shape : undefined,
    color: typeof b?.color === "string" && b.color ? b.color : undefined,
    font: typeof b?.font === "string" && b.font ? b.font : undefined,
    align:
      b?.align === "left" || b?.align === "center" || b?.align === "right"
        ? b.align
        : undefined,
    background:
      typeof b?.background === "string" && b.background
        ? b.background
        : undefined,
    shadow: b?.shadow === true ? true : undefined,
    ui: resolvedUI(b),
    // Stamped on by the loader; re-validated here because a map read off a cached doc has not been through the schema.
    cc: resolvedCc(b),
    inputs: normalizeInputs(b?.inputs),
    outputs: normalizeOutputs(b?.outputs),
    // `category` is the type FOLDER, kept AND derived from because `emits` alone can't pick an icon.
    category: b?.category ? String(b.category) : undefined,
    folderAbs: typeof b?.folderAbs === "string" ? b.folderAbs : undefined,
    emits: moduleEmits(b?.category, b?.io, normalizeOutputs(b?.outputs)),
    // Both halves of every file-valued param, because validate() needs the pair (docs/graphModel.md).
    model: b?.model,
    onnx: b?.onnx,
    assets: b?.assets,
    // Inherited like `plugin`, so a node of a module that says where its model lives says so too.
    model_url:
      typeof b?.model_url === "string" && b.model_url ? b.model_url : undefined,
    source: typeof b?.source === "string" && b.source ? b.source : undefined,
    channel: normInput(b?.channel),
    monitor: monitorMode(b?.monitor),
    // A NOTE's text, on a doc module, drawn on the node itself — see docs/docModules.md.
    content: typeof b?.content === "string" ? b.content : undefined,
    // The RACK this module is, if it is one, `extends` already folded in by `resolvedRack`.
    rack: resolvedType(b) === "rack" ? resolvedRack(b) : undefined,
    kit: kitOf(b?.kit),
    // The render this module is frozen to, if it is. A path, so an empty string is no freeze.
    frozen: typeof b?.frozen === "string" && b.frozen ? b.frozen : undefined,
    automations: normAutomations(b?.automations),
    // Only when there is a CHOICE: one entry is the module's own fields, which is not a menu.
    ...(() => {
      const all = alternativesOf(b);
      if (all.length < 2) return {};
      return {
        alternatives: all.map((a) => a.name),
        alternative: all[currentAlternative(b)].name,
      };
    })(),
    // …and the same for its engines: one is not a choice.
    ...(() => {
      const names = engineNames(b);
      return names.length < 2
        ? {}
        : { engines: names, engine: currentEngine(b) };
    })(),
  });

  // Video lanes as the graph and timeline read them; there is no `disabled` counterpart (docs/graphModel.md).
  const videoTracks: Record<string, VideoTrack> = {};
  for (const [id, t] of Object.entries(videoTracksMap ?? {}))
    videoTracks[id] = {
      name: String(t?.name ?? id),
      color: t?.color ? String(t.color) : undefined,
      mute: !!t?.mute,
    };

  // Resolve ONCE here, so no consumer downstream has to know inheritance exists (see moduleResolve.ts).
  const refsRaw = moduleRefsMap ?? {};
  const resolved: Record<string, ResolvedModule> = {};
  for (const [name, b] of Object.entries(modulesMap ?? {}))
    resolved[name] = resolveModule(b, refsRaw);

  const modules: Record<string, Module> = {};
  for (const [name, b] of Object.entries(resolved)) modules[name] = toModule(b);

  const moduleRefs: Record<string, Module> = {};
  for (const [ref, b] of Object.entries(resolveModuleMap(refsRaw)))
    moduleRefs[ref] = toModule(b);

  // --- the LANES: a lane is a node of one of the five track modules (docs/trackModules.md) ---
  const lanes = lanesOf(resolved);

  // Silenced lanes, from the ONE place a bypass is written; a lane carries no `mute:` of its own.
  const bypassed = bypassedOf(chainsMap);

  // A DISABLED lane is dropped here and so is every chain sourced from it — see docs/graphModel.md.
  const disabledTracks = new Set(
    Object.entries(lanes)
      .filter(([, l]) => l.disabled)
      .map(([name]) => name),
  );

  const tracks: Record<string, Track> = {};
  for (const [name, lane] of Object.entries(lanes)) {
    if (disabledTracks.has(name)) continue;
    tracks[name] = {
      name,
      type: lane.type,
      color: lane.color,
      mute: bypassed.has(name),
      // Derived by the surface, never written. See the note on Track.solo.
      solo: false,
      placements: lane.events.map(
        (p): Placement => ({
          ref: String(p.ref ?? ""),
          start: pos(p.start),
          loop: Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1),
          kind: clipsMap[String(p.ref)]
            ? "audio"
            : seqMap[String(p.ref)]
              ? "midi"
              : "missing",
        }),
      ),
      tracks: lane.tracks,
      strudel: lane.strudel,
      ...(lane.videoSource ? { videoSource: lane.videoSource } : {}),
    };
  }

  // Chains, minus the ones a disabled lane feeds DIRECTLY, and told which nodes are lanes — see docs/graphModel.md.
  const chains: Record<string, Chain> = {};
  const isLane = (n: string) =>
    modules[n]?.kind === "track" || !!videoTracks[n];
  for (const [name, chain] of Object.entries(parseChains(chainsMap, isLane))) {
    if (chain.from && disabledTracks.has(chain.from)) continue;
    chains[name] = chain;
  }

  const g: GraphDoc = {
    project: {
      name: String(root.project?.name ?? "untitled"),
      tempo: Number(root.project?.tempo ?? 120),
      sampleRate: Number(root.project?.sampleRate ?? 48000),
      timeSignature: String(root.project?.timeSignature ?? "4/4"),
    },
    chains,
    tracks,
    videoTracks,
    disabledTracks: [...disabledTracks].sort(),
    modules,
    moduleRefs,
    ...(positionsOf(chainsMap) ? { positions: positionsOf(chainsMap) } : {}),
    assemblies: assembliesMap,
    warnings: [],
  };
  g.warnings = validate(g);
  return g;
}

// The pins, read defensively: `chainsMap` may be the inline `root.chains`, which no schema saw.
function positionsOf(
  chainsMap: unknown,
): Record<string, { x: number; y: number }> | undefined {
  const p = (chainsMap as { positions?: unknown })?.positions;
  if (!p || typeof p !== "object") return undefined;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const at = v as { x?: unknown; y?: unknown };
    if (typeof at?.x === "number" && typeof at?.y === "number")
      out[k] = { x: at.x, y: at.y };
  }
  return Object.keys(out).length ? out : undefined;
}

// --- loader (fs) -------------------------------------------------------------

// Asks the module cache twice, and one stamp walk covers the pair — see moduleCache.ts.
export function loadGraph(dir: string): GraphDoc {
  return withModuleStamp(dir, () => loadGraphIn(dir));
}

function loadGraphIn(dir: string): GraphDoc {
  const root = loadProjectRoot(dir, true); // the root file -> project, markers
  // graph.yaml when there is one, read ONCE so the two formats can't disagree within one load (see loadChains).
  const rootChains = loadChains(dir, root, true);
  const videoTracksMap = loadVideoTracks(dir, true);
  const clipsMap = exportSub(dir, "clips");
  const seqMap = exportSub(dir, "sequences");

  // modules/<type>/ keyed by bare name, then the same modules re-keyed by ref (the `extends` vocabulary).
  const localModules = loadModules(dir, true); // enforced: a bad module fails the load
  const moduleRefsMap = loadModuleRefs(dir);
  // Which nodes are LANES has to be settled BEFORE the chains are derived — see docs/graphModel.md.
  const localResolved = resolveModuleMap(localModules, moduleRefsMap);
  const lanes = lanesOf(localResolved);
  // A PICTURE lane is a lane too, as buildGraph says below: else a lane both fed and feeding is absorbed into a run.
  const parsedChains = parseChains(
    rootChains,
    (n) => n in lanes || !!videoTracksMap[n],
  );
  // …and the shared modules the chains name by ref, so a step can use one directly.
  const modulesMap = withChainModuleRefs(
    localModules,
    moduleRefsMap,
    parsedChains,
  );

  // Module input wiring is a hard constraint: a mis-wired graph fails to read.
  const inputErrs = checkChainInputs(
    parsedChains,
    modulesMap,
    lanes,
    clipsMap,
    seqMap,
    videoTracksMap,
    new Set(tapFeedsOf(rootChains).map((f) => f.to)),
  );
  if (inputErrs.length)
    throw new Error(
      `module input wiring invalid:\n  - ${inputErrs.join("\n  - ")}`,
    );

  const g = buildGraph(
    root,
    rootChains ?? {},
    clipsMap,
    seqMap,
    modulesMap,
    moduleRefsMap,
    videoTracksMap,
    resolveAssemblies(dir),
  );
  // The taps routed to subchains, which a cable on the graph draws from the tap's own output (docs/racks.md).
  const feeds = tapFeedsOf(rootChains);
  if (feeds.length) g.tapFeeds = feeds;
  // A chain project's link levels, laid on as the compile lays them, and named where none is played (docs/chainFiles.md).
  applyLinkLevels(g.chains, loadLinkLevels(dir));
  g.warnings.push(
    ...unplayedLevels(
      g.chains,
      (to) => isSink(g, to),
      (n) => n in g.tracks || g.disabledTracks.includes(n),
    ),
  );
  g.warnings.push(...checkInputLabels(g));
  return g;
}

// Whether each input module's channel label exists on THIS machine, kept out of the pure validate() (docs/graphModel.md).
function checkInputLabels(g: GraphDoc): string[] {
  const w: string[] = [];
  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch {
    return w; // unreadable preferences shouldn't fail a load
  }
  for (const [name, b] of Object.entries(g.modules)) {
    if (!isInputModule(g, b) || b.channel == null) continue;
    const { unknownLabel } = resolveInput(b.channel, prefs);
    if (!unknownLabel) continue;
    const known = prefs.channels.in.map((c) => c.label).join(", ");
    w.push(
      `input '${name}': channel '${unknownLabel}' is not an input label in preferences.yaml ` +
        `preferences — ${known ? `have: ${known}` : "none are defined"}`,
    );
  }
  return w;
}
