// graph.ts — load and inspect a node/track/chain project (`studio-graph <project>`): clips and sequences are
// the material, tracks arrange them, modules wrap a plugin or rack, and chains route a track through modules to
// the OUT sink. Chains are DERIVED from graph.yaml's segments (chainsGraph.ts). See docs/nodeProjectLayout.md.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { WebOut } from "@studio/graph-model";
import {
  alternativesOf,
  currentAlternative,
} from "@studio/song-schema/alternatives";
import { currentEngine, engineNames } from "@studio/song-schema/engines";
import {
  CAMERA_IO,
  curveIdFromRef,
  isBuiltinOutput,
  isIoSource,
  isPicturePass,
  MIDI_IN_IO,
  MIX_NODE,
  type ModuleKind,
  portRef,
  RENDER_NODE,
  SHAPE_CATEGORY,
  splitPort,
  TRANSITION_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import { parsePosition } from "@studio/song-schema/timecode";
import type { ControllerFile } from "@studio/song-schema/yaml/moduleSchema";
import { type Assembly, resolveAssemblies } from "./assemblies";
import { loadLinkLevels } from "./chainProject";
import { bypassedOf, deriveChains, isParked } from "./chainsGraph";
import { applyLinkLevels, unplayedLevels } from "./linkLevels";
import {
  exportSub,
  isVideoSource,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
  moduleEmits,
  NODE_SEP,
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
import { loadPreferences, type Preferences, resolveInput } from "./preferences";
import type {
  LoadedModule,
  RawClip,
  RawPlugin,
  RawProjectRoot,
  RawSequence,
  RawVideoTrack,
} from "./rawDoc";
import { type TapFeed, tapFeedsOf } from "./tapOuts";
import { type Lane, laneMaterials, laneSignal, lanesOf } from "./trackModule";

// Where an unnamed node sits, for whatever SHOWS one — this package exports no chainProject subpath.
export {
  type NodePlace,
  nodeCaption,
  nodePlaces,
  nodeStacks,
  placeOf,
} from "./nodePlace";

// --- model -------------------------------------------------------------------

export interface Placement {
  ref: string;
  start: number;
  // How many passes of the material's window, not how long it sounds (see PlacementSchema).
  loop: number;
  kind: "audio" | "midi" | "missing";
}
// A LANE as every surface downstream reads one — a projection of a track module, not an entity; see docs/graphModel.md.
export interface Track {
  name: string;
  type: "single" | "group" | "strudel";
  color?: string; // authored display colour (hex, e.g. "#ff5706"); absent when unset
  // Silenced. Read off `graph.yaml`'s `bypassed:` — the lane file carries no `mute:` of its own.
  mute: boolean;
  // Always false: solo is a session state the surface derives by bypassing every OTHER lane.
  solo: boolean;
  placements: Placement[]; // single only
  tracks: string[]; // group only: member lane names
  strudel?: string; // strudel only: project-relative path to its pattern file
  videoSource?: string; // the PICTURE lane whose shots this lane sounds (docs/videoSound.md)
}
// A video lane as the graph and the timeline need it; its geometry and placements stay in the compiled ProjectDoc.
export interface VideoTrack {
  name: string;
  color?: string;
  mute: boolean; // "mute" == hidden, for a video lane
}

export interface Step {
  module: string; // a module node name
  in?: string[]; // extra input sources feeding the module's ports past the chain flow
  enabled?: boolean; // undefined/true == on; false == bypassed
}
// A typed input port derived from a module's type folder. `mandatory` ports must be fed.
export interface InputDef {
  name: string;
  type: "audio" | "midi" | "video";
  mandatory: boolean;
}
// …and a typed OUTPUT port. No `mandatory` twin: an output is offered, never required. See docs/ports.md.
export interface OutputDef {
  name: string;
  type: "audio" | "midi" | "video";
}
// A signal destination — the SAME shape the browser receives, not a second declaration of it; see docs/graphModel.md.
export type Out = WebOut;
export interface Chain {
  from?: string;
  // Which of the source lane's OUTPUTS this run left by, absent unless the lane was keyed on both (docs/trackModules.md).
  fromPort?: string;
  use: Step[]; // ordered module nodes: from -> use[0] -> … -> out
  enabled?: boolean; // whole-chain bypass
  out: Out[];
}
// The kinds of widget a module UI can place: `label` draws text, `meter` is read-only, every other kind binds to a param.
export type WidgetType =
  | "label"
  | "knob"
  | "slider"
  | "fader"
  | "number"
  | "toggle"
  | "button"
  | "meter"
  | "waveform"
  | "dropdown"
  | "lcdscreen"
  | "group";

// One widget on a module's grid — see #Widget in the schema above for the contract.
export interface Widget {
  type: WidgetType;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  hidden?: boolean;
  text?: string; // label only
  bind?: string; // everything but label/waveform: the param name
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  source?: "input" | "output"; // waveform only: which audio tap to display
  // dropdown only: a discrete param's named settings…
  options?: { label: string; value: number }[];
  // …or the library folder its choices are listed from ("ir"), where `bind` names a MODULE field (see #Widget).
  library?: string;
  color?: string; // group only: its background colour
  pair?: string; // knob only: the dry param of a crossfade knob
}
// One tab of a panel: its name, and the widgets drawn while it is open.
export interface UiTab {
  name: string;
  widgets: Record<string, Widget>;
}
// A module's UI: widgets on a grid, keyed by a stable id (the override key); `widgets` show on every tab.
export interface ModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, Widget>;
  tabs?: UiTab[];
  // The source of the `widgets.js` beside the panel, which draws its lcdscreen widgets.
  script?: string;
  // The panel laid out NARROW, at most 4 columns — absent, the panel serves both shapes (song-schema's LayoutSchema).
  vertical?: Omit<ModuleUI, "script" | "vertical">;
}

// One rack sound triggered by a MIDI note: its own `clip` in a "samples" rack, a [from, to) second window in a "slice" one.
export interface RackSound {
  note: number; // MIDI note 0..127 the sound maps to
  sample?: string; // a TAP's library sample, `@<library>/<path>` — resolved into `clip` by the loader
  clip?: string; // samples: a clips/<id> id (resolved to an absolute path for the engine)
  from?: number; // slice: window start in the source, seconds
  to?: number; // slice: window end in the source, seconds
  mute?: boolean; // silenced: drawn on its pad, never sent to the sampler
}
export type RackType = "samples" | "slice";
// A rack: how a set of symbols (e.g. "BD", "HH") get their audio — see docs/racks.md.
export interface Rack {
  rackType: RackType;
  source?: string; // slice: the clip id every symbol slices from
  symbols: Record<string, RackSound>;
}

// The AUTHORED instrument discriminator — distinct from the folder-derived `Module.kind` and from `plugin.type`.
export type InstrumentType = "plugin" | "rack";

// A module: a plugin (or io, or a rack) plus params, plus an optional `extends` it inherits defaults from.
export interface Module {
  extends?: string; // the module this inherits from ("type/name" | "@ns/type/name"); "" when none
  kind: ModuleKind; // from the type folder — "plugin", "io", or "doc" (a note; see docModule.ts)
  io?: string; // io modules only: "out" (sink) | "in" (live source)
  plugin?: RawPlugin; // a plugin definition (plugin.type = xmlTypeName / cache id)
  type?: InstrumentType; // "plugin" (default) | "rack"
  // Numbers, except the file-valued ones (moduleTypes.FILE_PARAMS), which name a file in the module's assets/.
  params?: Record<string, number | string>;
  // Only usable on an input that is already a FILE — see docs/coldModules.md and isColdModule.
  cold?: boolean;
  // The engine's blend around the effect, 0..1 — carried to the plugin as its `@mix` param (engine docs/mix.md).
  mix?: number;
  // …and the levels on that same stage, in dB — carried as `@input-volume` / `@output-volume`.
  input_volume?: number;
  output_volume?: number;
  // Which named BASE this module starts from — the opaque state UNDER `params:`; see docs/userPresets.md.
  base?: string;
  // Which SHADER a shader node runs, absent when nothing is chosen — see packages/song-video/docs/shaders.md.
  shader?: string;
  // …and which PRIMITIVE a shape module draws, its geometry being `params:` — see song-video/docs/shapes.md.
  shape?: string;
  // What a shape is FILLED with, and on a lane module its colour in the timeline — one key, read by category.
  color?: string;
  // A `text` shape's CSS font family; its string is `content:`, the key a doc note already uses.
  font?: string;
  ui?: ModuleUI;
  // What this module LOADS when it is a rack, `extends` already merged in; absent for a plugin.
  rack?: Rack;
  // …and an SFZ kit's pads, name → note, which the kit itself plays (docs/racks.md).
  kit?: Record<string, number>;
  // Which MIDI CC plays which param, keyed by the widget's `bind` string verbatim (controller.ts).
  cc?: ControllerFile;
  inputs: InputDef[]; // typed input ports from the type folder (empty == unconstrained)
  // …and its output ports, carried beside `emits` rather than derived from it — see docs/graphModel.md.
  outputs: OutputDef[];
  // The module's TYPE FOLDER, which is what says what KIND of module this is; see docs/graphModel.md.
  category?: string;
  // The ABSOLUTE folder this module's files live in, stamped by the loader; `moduleAssetChoices` walks the ancestry off these.
  folderAbs?: string;
  // What this module EMITS — the signal on the cable leaving it (see moduleEmits); undefined for a sink.
  emits?: "audio" | "midi" | "video";
  // The file a file-valued param names, resolved to an ABSOLUTE path for the engine, or undefined when assets/ lacks it.
  model?: string;
  // …the same for the neural MODEL an offline module runs, resolved against its assets/ then the machine's cache.
  onnx?: string;
  // …and what the module SAYS, per param: the short assets-relative name; the two disagreeing is how a dangling ref is spotted.
  assets?: Record<string, string>;
  // Where that model can be downloaded from when the machine has not got it — docs/moduleAssets.md.
  model_url?: string;
  // io: "file" only — the audio file this source reads, project-relative; absent in a chain TEMPLATE.
  source?: string;
  // io: "in" only — a live interface input, as DECLARED rather than resolved; see docs/graphModel.md.
  channel?: string | number[];
  // io: "camera" only — WHICH lens, by the LABEL a person reads; "" or absent is the default one.
  camera?: string;
  // io: "midi" only — WHICH MIDI device it records from, by its label; "" or absent is any device.
  device?: string;
  // …and where in the viewport it draws, [x, y, w, h] in px; absent is the whole frame.
  frame?: number[];
  monitor?: "off" | "auto" | "on";
  // A NOTE's text on a doc module — multiline, drawn as written on the node itself; see docs/docModules.md.
  content?: string;
  // Which curve (by id, from curves/) drives which param here; drawn by the web graph, no engine meaning yet.
  automations?: Automation[];
  // The module's other attribute SETS and which one is ON, carried after the merge — see docs/graphModel.md.
  alternatives?: string[];
  alternative?: string;
  // The modules it can run AS and which one it does, sent only when there is a choice — docs/engines.md.
  engines?: string[];
  engine?: string;
  // The render standing in for everything upstream of this module, itself included — see docs/freeze.md.
  frozen?: string;
}
// One automation binding: a curve id driving a named param (mirrors #Automation).
export interface Automation {
  param: string;
  curve: string;
}

export interface GraphDoc {
  project: {
    name: string;
    tempo: number;
    sampleRate: number;
    timeSignature: string;
  };
  chains: Record<string, Chain>;
  // The tracks the song actually plays: a DISABLED track is absent, and so is any chain sourced from one.
  tracks: Record<string, Track>;
  // Video tracks (video_tracks/<id>.yaml), kept SEPARATE from `tracks` — see docs/graphModel.md.
  videoTracks: Record<string, VideoTrack>;
  // The ids left out for being disabled, so validate() can tell "you disabled this" from "this doesn't exist".
  disabledTracks: string[];
  // Modules keyed by BARE NAME — what chains reference (use / out); the io sink "OUT" is a module here too.
  modules: Record<string, Module>;
  // The same modules keyed by REF — the `extends` vocabulary, resolved like `modules` (see moduleResolve.ts).
  moduleRefs: Record<string, Module>;
  // graph.yaml's `positions:`, verbatim; nothing about the SIGNAL reads it, it rides through to the renderer.
  positions?: Record<string, { x: number; y: number }>;
  // The `assemblies/` folder, RESOLVED — a drawing fact the compiler never reads, see docs/assemblies.md.
  assemblies: Record<string, Assembly>;
  // A rack node's taps routed to subchains, each with the first node of the run it feeds (docs/racks.md).
  tapFeeds?: TapFeed[];
  warnings: string[];
}

// The chains, derived from the file's segments (chainsGraph.ts), re-exported under the name every consumer already calls.
export const parseChains = deriveChains;

// A port's signal, defaulting to audio; `video` is spelled out so a video chain is not rejected by the positional check.
const portSignal = (t: unknown): "audio" | "midi" | "video" =>
  t === "midi" ? "midi" : t === "video" ? "video" : "audio";

// Normalize a module's declared input ports (from its type folder); absent or empty == unconstrained.
function normalizeInputs(raw: unknown): InputDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; type?: unknown; mandatory?: unknown }[]).map(
    (i): InputDef => ({
      name: String(i?.name ?? ""),
      type: portSignal(i?.type),
      mandatory: i?.mandatory !== false,
    }),
  );
}

// …and its outputs. The same shape minus `mandatory`, which an output has no use for.
function normalizeOutputs(raw: unknown): OutputDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; type?: unknown }[]).map(
    (o): OutputDef => ({
      name: String(o?.name ?? ""),
      type: portSignal(o?.type),
    }),
  );
}

// The signal a track puts on a wire, or undefined when it cannot be said — see docs/graphModel.md.
function trackType(
  lane: Lane | undefined,
  port: string | undefined,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
): "audio" | "midi" | undefined {
  if (!lane || lane.type === "group") return undefined;
  if (port === "midi" || port === "audio") return port;
  return laneSignal(
    laneMaterials(lane.events, (ref) =>
      seqs?.[ref] ? "midi" : clips?.[ref] ? "audio" : "missing",
    ),
  );
}

// The type a chain-input source id resolves to, or undefined when unknowable — see docs/graphModel.md.
function sourceType(
  id: string,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  videoTracks?: Record<string, RawVideoTrack>,
): "audio" | "midi" | "video" | undefined {
  if (seqs?.[id]) return "midi";
  if (clips?.[id])
    return isVideoSource(String(clips[id]?.source ?? "")) ? "video" : "audio";
  const { node, port } = splitPort(id);
  if (lanes?.[node]) return trackType(lanes[node], port, clips, seqs);
  if (videoTracks?.[node]) return "video";
  return undefined;
}

// Check that every chain feeds each module the input ports its type folder declares; a non-empty result is FATAL (docs/graphModel.md).
// An SFZ kit's pads as the module states them, name → note; anything else is no kit.
function kitOf(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const pads = Object.entries(v as Record<string, unknown>).filter(
    (e): e is [string, number] => Number.isInteger(e[1]),
  );
  return pads.length ? Object.fromEntries(pads) : undefined;
}

export function checkChainInputs(
  // Already parsed and keyed by resolved name (see parseChains) — not the raw export.
  parsed: Record<string, Chain>,
  modules: Record<string, LoadedModule>,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  // Video tracks (video_tracks/<id>.yaml): a chain sourced from one types as "video".
  videoTracks: Record<string, RawVideoTrack> = {},
  // The first nodes of runs a rack's TAP feeds: fed with audio, though no edge says so (docs/racks.md).
  tapFed: ReadonlySet<string> = new Set(),
): string[] {
  const errs: string[] = [];

  // Chains routed into by another chain's `out`, so their first module has a flow even without a `from`.
  const routedInto = new Set<string>();
  for (const c of Object.values(parsed))
    for (const o of c.out) routedInto.add(o.to);

  for (const [chainName, c] of Object.entries(parsed)) {
    if (isParked(c)) continue; // placed, not wired yet — nothing to check the ports of
    // A group carries no signal, and the compiler would drop this chain's plugins silently — see docs/graphModel.md.
    if (c.from && lanes?.[c.from]?.type === "group")
      errs.push(
        `chain '${chainName}': from '${c.from}' is a group — groups carry no signal; name a member track`,
      );

    const steps = c.use;
    steps.forEach((step, idx) => {
      if (step?.enabled === false) return; // a bypassed step passes signal through untouched
      const module = modules?.[step?.module];
      if (!module) return; // a missing module is reported by validate()
      const inputs = normalizeInputs(module.inputs);
      if (!inputs.length) return; // opts out of input checking

      // Sources feeding this step in port order, each with its resolved type or undefined when unknowable.
      const tapped = idx === 0 && tapFed.has(step.module);
      // A STRETCH's head is fed by the shot its fade runs on, which no edge says (song-video/docs/transitions.md).
      const shot =
        idx === 0 &&
        !c.from &&
        !routedInto.has(chainName) &&
        inputs[0]?.type === "video" &&
        c.out.some((o) => !!videoTracks[splitPort(o.to).node]);
      const hasFlow =
        idx > 0 ||
        (idx === 0 &&
          (!!c.from || routedInto.has(chainName) || tapped || shot));
      const sources: {
        id: string;
        type: "audio" | "midi" | "video" | undefined;
      }[] = [];
      if (hasFlow)
        sources.push(
          idx === 0 && c.from
            ? {
                // With the port when the run left by one: a detyped lane's own address says what it carries.
                id: c.fromPort
                  ? portRef(String(c.from), c.fromPort)
                  : String(c.from),
                type: sourceType(
                  c.fromPort
                    ? portRef(String(c.from), c.fromPort)
                    : String(c.from),
                  lanes,
                  clips,
                  seqs,
                  videoTracks,
                ),
              }
            : tapped
              ? { id: "(tap)", type: "audio" }
              : shot
                ? { id: "(shot)", type: "video" }
                : { id: "(flow)", type: undefined },
        );
      for (const s of Array.isArray(step.in) ? step.in : [])
        sources.push({
          id: String(s),
          type: sourceType(String(s), lanes, clips, seqs, videoTracks),
        });

      const where = `chain '${chainName}' step ${idx + 1} (module '${step.module}')`;
      const mandatory = inputs.filter((i) => i.mandatory).length;
      if (sources.length < mandatory)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but ${mandatory} mandatory port(s) required`,
        );
      else if (sources.length > inputs.length)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but the module has only ${inputs.length} port(s)`,
        );

      // Positional type check, where the source's type is knowable.
      inputs.forEach((inp, i) => {
        const src = sources[i];
        if (!src || src.type === undefined) return;
        if (src.type !== inp.type)
          errs.push(
            `${where}: port '${inp.name}' expects ${inp.type} but source '${src.id}' is ${src.type}`,
          );
      });
    });
  }
  return errs;
}

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

function normMonitor(v: unknown): "off" | "auto" | "on" | undefined {
  return v === "off" || v === "auto" || v === "on" ? v : undefined;
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
    // The shape a `shapes` module draws, and how it is painted — inherited like `plugin` (docs/shapes.md).
    shape: typeof b?.shape === "string" && b.shape ? b.shape : undefined,
    color: typeof b?.color === "string" && b.color ? b.color : undefined,
    font: typeof b?.font === "string" && b.font ? b.font : undefined,
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
    monitor: normMonitor(b?.monitor),
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

// Is `id` a sink: something the signal ENDS at, by name (OUT, MIX, RENDER, VIDEO_OUT, CUE), by role, or by shape.
const isSink = (g: GraphDoc, id: string): boolean => {
  // The five built-in outputs have no folder behind them — see docs/graphModel.md.
  if (isBuiltinOutput(id)) return true;
  const m = g.modules[id];
  if (!m) return false;
  // A NOTE ends a run too: it takes one input and gives nothing back, so it is a sink by SHAPE.
  if (m.kind === "doc") return true;
  return m.kind === "io" && !isIoSource(m.io);
};
// The other io edge: a LIVE interface source (io: "in"), deliberately narrower than "is a source" (docs/graphModel.md).
export const isInputModule = (_g: GraphDoc, b: Module): boolean =>
  b.kind === "io" && b.io === "in";
/** …and the CAMERA, the one io source whose signal is a picture. See docs/camera.md.
 *
 * Kept apart from `isInputModule` for the reason that one is narrow: everything it gates — a
 * channel, monitoring, a trim, the tuner — is about a physical AUDIO input, and none of it means
 * anything for a lens. What a camera shares with it is only that signal comes FROM it. */
export const isCameraModule = (b: Module): boolean =>
  b.kind === "io" && b.io === CAMERA_IO;

/** …and a MIDI device (io: "midi"): notes the BROWSER records onto the lane it feeds. See docs/midiIn.md. */
export const isMidiInModule = (b: Module): boolean =>
  b.kind === "io" && b.io === MIDI_IN_IO;

/** …and the file source (io: "file"), which reads audio off disk. See docs/fileInput.md. */
export const isFileInputModule = (b: Module): boolean =>
  b.kind === "io" && b.io === "file";

/** A SHAPE: the other picture source, drawn rather than filmed — see song-video/docs/shapes.md. */
export const isShapeModule = (b: Module): boolean =>
  b.category === SHAPE_CATEGORY;
// The " — did you mean …" tail when the last `/` should have been the node separator; see docs/graphModel.md.
function nodeHint(g: GraphDoc, name: string): string {
  const cut = name.lastIndexOf("/");
  if (cut < 0) return "";
  const asNode = `${name.slice(0, cut)}${NODE_SEP}${name.slice(cut + 1)}`;
  return g.modules[asNode] || g.moduleRefs[asNode]
    ? ` — did you mean '${asNode}'? a node is named with '${NODE_SEP}', not '/'`
    : "";
}

// The chain a module RUNS INSIDE, when it is a step rather than a meeting point of its own — see docs/graphModel.md.
function chainHosting(g: GraphDoc, node: string): string | undefined {
  for (const [name, c] of Object.entries(g.chains))
    if (c.use.some((s) => s.module === node)) return name;
  return undefined;
}

// The chain a destination continues in: itself when it names one, else the run hosting the module it lands on.
function chainAt(g: GraphDoc, to: string): string | undefined {
  const { node } = splitPort(to);
  return g.chains[node] ? node : chainHosting(g, node);
}

// A destination the signal can legitimately arrive at; the PORT is stripped first, every question here is about the module.
const isNode = (g: GraphDoc, id: string): boolean => {
  const { node } = splitPort(id);
  return !!g.chains[node] || isSink(g, node) || !!chainHosting(g, node);
};
/** Does this chain carry a CAMERA — a live picture, which is what a video lane may be fed by? */
export const carriesCamera = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isCameraModule(b);
  });

/** …and does it carry a SHAPE, the other thing a picture lane may be fed by (docs/shapes.md)? */
export const carriesShape = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isShapeModule(b);
  });

/** …or is it a STRETCH: picture passes nothing feeds, landing on a picture lane, run by a fade's `chain:` (song-video/docs/transitions.md). */
export const isStretch = (g: GraphDoc, c: Chain): boolean => {
  const head = c.use[0]?.module;
  if (c.from || !head) return false;
  if (!c.out.some((o) => !!g.videoTracks[splitPort(o.to).node])) return false;
  if (!c.use.every((s) => isPicturePass(g.modules[s.module]?.category)))
    return false;
  // A run another one feeds is a meeting point of that signal, not a shot's.
  return !Object.values(g.chains).some((o) =>
    o.out.some((x) => splitPort(x.to).node === head),
  );
};

/** Does this chain carry a MIDI device — notes a lane may be fed by, for the browser to record? */
export const carriesMidiIn = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isMidiInModule(b);
  });

/** Does this chain carry a live interface input? */
const carriesInput = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isInputModule(g, b);
  });

/** …and the other source: does its signal come off DISK (an `io: file` step)? */
export const carriesFileInput = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isFileInputModule(b);
  });

/** A module that only works on material already on disk. See docs/coldModules.md. */
export const isColdModule = (b: Module | undefined): boolean =>
  b?.cold === true;

// Why `module` may not be added after `at`, or null when it may — THE one place the cold rule is decided (docs/graphModel.md).
export function coldPlacementError(
  g: GraphDoc,
  module: Module | undefined,
  name: string,
  at: string | undefined,
): string | null {
  if (!isColdModule(module)) return null;
  if (at === undefined) return null;
  const { node } = splitPort(at);
  const hostName = g.chains[node] ? node : chainHosting(g, node);
  const chain = hostName ? g.chains[hostName] : undefined;
  if (chain && carriesFileInput(g, chain)) return null;
  return (
    `'${name}' is a COLD module: it has to know the whole of its input before it can produce any ` +
    `of it, so it only works on audio already on disk. ` +
    (chain
      ? `The chain at '${at}' has no file input (io: file) — a live input has no "whole" yet. ` +
        `Use it in a médiathèque chain over a song, or give this chain a file source.`
      : `'${at}' is not part of a chain drawing from a file.`)
  );
}

// The track a chain's live input lands on: its own source track when the input is a step ON it, else the track its run ends at.
export function inputLandingTrack(
  c: Chain,
  isTrack: (id: string) => boolean,
): string {
  if (c.from) return c.from;
  return c.out.map((o) => o.to).find(isTrack) ?? "";
}

export function validate(g: GraphDoc): string[] {
  const w: string[] = [];
  // Tracks on disk but left out of `g.tracks` for being disabled, so a lookup miss can be told from a typo.
  const disabled = new Set(g.disabledTracks);

  for (const [name, c] of Object.entries(g.chains)) {
    // `from` may name a track, a video track or ANOTHER chain, never this one; MIX and RENDER are exempt (docs/graphModel.md).
    if (
      c.from &&
      c.from !== MIX_NODE &&
      c.from !== RENDER_NODE &&
      !g.tracks[c.from] &&
      !g.videoTracks[c.from] &&
      !(c.from !== name && g.chains[c.from])
    )
      w.push(`chain '${name}': from '${c.from}' is not a track or chain`);
    // A DETYPED lane holding both kinds, running down one chain that expects one of them — see docs/graphModel.md.
    if (c.from && !c.fromPort && c.use.length) {
      const lane = g.tracks[c.from];
      const kinds = new Set((lane?.placements ?? []).map((p) => p.kind));
      const wants = g.modules[c.use[0].module]?.inputs?.[0]?.type;
      if (
        kinds.has("audio") &&
        kinds.has("midi") &&
        (wants === "audio" || wants === "midi")
      )
        w.push(
          `chain '${name}': track '${c.from}' holds audio AND sequences, and '${c.use[0].module}' takes ${wants} —` +
            ` all of it goes through it. Split the lane: '${c.from}#audio:' and '${c.from}#midi:'`,
        );
    }
    for (const s of c.use) {
      const module = g.modules[s.module];
      if (!module)
        w.push(
          `chain '${name}': step module '${s.module}' is not a module or module node` +
            nodeHint(g, s.module),
        );
      else if (module.extends && !g.moduleRefs[module.extends])
        w.push(
          `chain '${name}': module '${s.module}' extends unknown module '${module.extends}'`,
        );
      // A transition is NAMED by a cut, not wired: said by name, since the ports cannot say it —
      // an empty `inputs` means UNCONSTRAINED here. See song-video/docs/transitions.md.
      else if (module.category === TRANSITION_CATEGORY)
        w.push(
          `chain '${name}': '${s.module}' is a transition, and a transition is not wired — a cut names it (\`fade_in: { over: 1, with: ${s.module} }\` on a placement in video_tracks/<lane>.yaml)`,
        );
    }
    for (const o of c.out) {
      // A destination may name a PORT (`crossfade#b`), so the jack comes off first; only the last `#` is the port.
      const { node: to } = splitPort(o.to);
      const target = g.modules[to];
      // Routing INTO a live input is meaningless, and is checked ahead of isNode, which says yes (docs/graphModel.md).
      if (target && isInputModule(g, target))
        w.push(
          `chain '${name}': out '${o.to}' is a live input — signal comes FROM it, not to it`,
        );
      // …and the same about a lens, which is the other thing signal only ever comes out of.
      else if (target && isCameraModule(target))
        w.push(
          `chain '${name}': out '${o.to}' is a camera — picture comes FROM it, not to it`,
        );
      // …and a MIDI device, the third: notes come FROM a keyboard, never to one.
      else if (target && isMidiInModule(target))
        w.push(
          `chain '${name}': out '${o.to}' is a MIDI device — notes come FROM it, not to it`,
        );
      // A PICTURE lane takes three things: a camera, a shape and a fade's stretch. Everything else
      // aimed at one is discarded silently — see docs/camera.md and song-video/docs/transitions.md.
      else if (g.videoTracks[to]) {
        if (!carriesCamera(g, c) && !carriesShape(g, c) && !isStretch(g, c))
          w.push(
            `chain '${name}': out '${o.to}' is a picture lane — only a camera's or a shape's picture lands on one, or a run of shaders nothing feeds (a fade's \`chain:\`)`,
          );
      }
      // Only a live input's signal may land on a LANE; anything else aimed at one is silently discarded.
      else if (g.tracks[to] || disabled.has(to)) {
        // A MIDI device lands on a lane too: it says what that lane RECORDS from (docs/midiIn.md).
        if (!carriesInput(g, c) && !carriesMidiIn(g, c))
          w.push(
            `chain '${name}': out '${o.to}' is a track — only a live input's or a MIDI device's signal lands on a lane`,
          );
      }
      // A camera is exempt from the last test: landing on no picture lane is not a fault, since it
      // draws a LAYER of its own and the document authors none — see docs/camera.md.
      else if (!isNode(g, o.to) && !carriesCamera(g, c))
        w.push(`chain '${name}': out '${o.to}' is not a chain or io sink`);
      if (o.gain < 0)
        w.push(`chain '${name}': out '${o.to}' has a negative gain`);
      // …and which output it LEFT from — see docs/graphModel.md.
      if (o.fromPort) {
        const src = c.use.length ? c.use[c.use.length - 1].module : c.from;
        const srcModule = src ? g.modules[src] : undefined;
        if (srcModule && !srcModule.outputs.some((p) => p.name === o.fromPort))
          w.push(
            `chain '${name}': out '${o.to}' leaves '${src}' through '${o.fromPort}', which is ` +
              `not one of its outputs (${srcModule.outputs.map((p) => p.name).join(", ") || "none"})`,
          );
      }
    }
    if (!c.out.length && !isParked(c))
      w.push(`chain '${name}': has no out (dead end)`);
  }

  for (const [id, t] of Object.entries(g.tracks))
    for (const p of t.placements)
      if (p.kind === "missing")
        w.push(`track '${id}': clip/sequence '${p.ref}' not found`);

  // A module naming a file its own assets/ doesn't hold: `nam` and `assets` disagreeing IS the report (docs/graphModel.md).
  for (const [name, b] of Object.entries(g.modules))
    for (const [param, ref] of Object.entries(b.assets ?? {}))
      if (!(b as unknown as Record<string, unknown>)[param])
        w.push(
          `module '${name}': ${param} '${ref}' is not in this module's assets/`,
        );

  // Live-input modules, walked over the CHAINS because an input is wired by the run it sits in (docs/graphModel.md).
  const fedBy = new Map<string, string>();
  for (const [_chainName, c] of Object.entries(g.chains)) {
    if (isParked(c)) continue; // an input dropped in but not wired yet lands nowhere, by design
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      if (b.channel == null)
        w.push(`input '${s.module}': no channel — it feeds nothing`);
      const track = inputLandingTrack(
        c,
        (id) => !!g.tracks[id] || disabled.has(id),
      );
      // No lane is no longer a fault: a run carrying an input and landing on none MATERIALISES its
      // own track, which is what a rig you play through is made of (docs/liveProject.md). There is
      // nothing further to check about a lane that does not exist, so the walk stops here.
      if (!track) continue;
      const target = g.tracks[track];
      if (!target)
        // Disabled reads as absent here, so say which it is rather than send the reader hunting for a typo.
        w.push(
          disabled.has(track)
            ? `input '${s.module}': track '${track}' is disabled — it records nothing`
            : `input '${s.module}': track '${track}' not found`,
        );
      else if (target.type === "group")
        w.push(
          `input '${s.module}': track '${track}' is a group — it holds no material`,
        );
      else if (target.type === "strudel")
        w.push(
          `input '${s.module}': track '${track}' is a strudel lane — its pattern is the source`,
        );
      // The engine assigns ONE input per track, so name both rather than let the last one loaded silently win.
      const prev = fedBy.get(track);
      if (prev)
        w.push(
          `track '${track}': fed by two inputs ('${prev}', '${s.module}') — only one can win`,
        );
      else fedBy.set(track, s.module);
    }
  }
  // `channel` anywhere else is silently ignored, which looks like it took effect.
  for (const [name, b] of Object.entries(g.modules))
    if (!isInputModule(g, b) && b.channel != null)
      w.push(
        `module '${name}': channel is for an io "in" module, but '${name}' is not one`,
      );

  // Group membership: a member must exist, must not be the group itself, and must belong to only one group.
  const claimed = new Map<string, string>();
  for (const [id, t] of Object.entries(g.tracks)) {
    if (t.type !== "group") continue;
    for (const m of t.tracks) {
      if (m === id) w.push(`group '${id}': contains itself`);
      // A disabled member is deliberate; only a member that exists nowhere is worth a warning.
      else if (!g.tracks[m] && !disabled.has(m))
        w.push(`group '${id}': track '${m}' not found`);
      const owner = claimed.get(m);
      if (owner) w.push(`track '${m}': in two groups ('${owner}', '${id}')`);
      else claimed.set(m, id);
    }
  }

  // Assembly membership: the same three questions a group's is, over any node rather than over lanes.
  const inBox = new Map<string, string>();
  for (const [id, a] of Object.entries(g.assemblies)) {
    // One flat key space: a box drawn under a name a chain step already spells is two things called one word.
    if (g.modules[id] || g.tracks[id])
      w.push(`assembly '${id}': a node of this project is already called that`);
    for (const [member, node] of Object.entries(a.members)) {
      if (!g.modules[node] && !g.tracks[node] && !disabled.has(node))
        w.push(
          `assembly '${id}': member '${member}' names '${node}', which this project has not got`,
        );
      const owner = inBox.get(node);
      if (owner)
        w.push(`node '${node}': in two assemblies ('${owner}', '${id}')`);
      else inBox.set(node, id);
    }
  }

  // Every source chain (has a track input) should reach a sink.
  for (const [name, c] of Object.entries(g.chains))
    if (c.from && !reachesSink(g, name, new Set()))
      w.push(`chain '${name}': nothing reaches OUT`);

  // Cycle check over chain→chain edges.
  for (const name of Object.keys(g.chains))
    if (hasCycle(g, name, new Set(), new Set())) {
      w.push(`chain '${name}': is part of a cycle`);
      break;
    }

  return w;
}

function reachesSink(g: GraphDoc, name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const c = g.chains[name];
  if (!c) return false;
  return c.out.some((o) => {
    if (isSink(g, splitPort(o.to).node)) return true;
    // A side input lands on a step inside ANOTHER run, so the walk continues there — see docs/graphModel.md.
    const next = chainAt(g, o.to);
    return !!next && reachesSink(g, next, seen);
  });
}

function hasCycle(
  g: GraphDoc,
  name: string,
  stack: Set<string>,
  done: Set<string>,
): boolean {
  if (stack.has(name)) return true;
  if (done.has(name) || !g.chains[name]) return false;
  stack.add(name);
  const cycle = g.chains[name].out.some((o) => {
    // Through a port too: a loop drawn with side inputs is exactly as unplayable as one drawn with bare ones.
    const next = chainAt(g, o.to);
    return !!next && hasCycle(g, next, stack, done);
  });
  stack.delete(name);
  done.add(name);
  return cycle;
}

// --- describe (pure) ---------------------------------------------------------

export function describeGraph(g: GraphDoc): string[] {
  const lines: string[] = [];
  // Roots are the chains fed by a track; intermediate nodes have `from` = another chain and are shown via downstream().
  const roots = Object.entries(g.chains).filter(
    ([, c]) => c.from && g.tracks[c.from],
  );

  // Roots plus every chain reachable downstream, so no subbranch is re-listed after a root's trace.
  const reached = new Set<string>();
  const mark = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const o of g.chains[name]?.out ?? []) if (g.chains[o.to]) mark(o.to);
  };
  for (const [name] of roots) mark(name);

  for (const [name, c] of roots) {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    lines.push(head + downstream(g, c.out, new Set([name])));
  }
  // subbranch chains not reached from any root
  for (const [name, c] of Object.entries(g.chains))
    if (!reached.has(name))
      lines.push(
        `${name} (subbranch): ${stepsDesc(g, c) || name}${downstream(g, c.out, new Set([name]))}`,
      );

  return lines;
}

// Resolve a user-supplied track reference (id or display name, case-insensitive) to a track id.
export function resolveTrack(g: GraphDoc, ref: string): string | undefined {
  if (g.tracks[ref]) return ref;
  const lc = ref.toLowerCase();
  for (const [id, t] of Object.entries(g.tracks))
    if (id.toLowerCase() === lc || t.name.toLowerCase() === lc) return id;
  return undefined;
}

// The chains one track feeds, each traced downstream through its steps to the sink — a focused graph display.
export function describeTrackGraph(g: GraphDoc, trackId: string): string[] {
  const roots = Object.entries(g.chains).filter(([, c]) => c.from === trackId);
  if (!roots.length) return [`track '${trackId}' feeds no chains`];
  return roots.map(([name, c]) => {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    return head + downstream(g, c.out, new Set([name]));
  });
}

function trackDesc(g: GraphDoc, from: string): string {
  const t = g.tracks[from];
  if (!t) return g.chains[from] ? `chain '${from}'` : `track '${from}'(?)`;
  const clips = t.placements
    .map((p) => `${p.ref}@${p.start}${p.kind === "missing" ? "(?)" : ""}`)
    .join(", ");
  return `${inputDesc(g, from)}track '${from}' [${clips}]`;
}

// How an io "in" module reads as a node — "in 'guitar'(ch 1) -> ", drawn ahead of the track it feeds; "" when none does.
function inputDesc(g: GraphDoc, trackId: string): string {
  const hit = inputsByTrack(g).get(trackId);
  return hit ? `${nodeDesc(hit[0], hit[1])} -> ` : "";
}

function nodeDesc(name: string, b: Module): string {
  const ch =
    b.channel == null
      ? "?"
      : Array.isArray(b.channel)
        ? b.channel.join("+")
        : `'${b.channel}'`;
  // "auto" is the default and says nothing; off/on are deliberate choices.
  const mon = b.monitor && b.monitor !== "auto" ? ` mon:${b.monitor}` : "";
  return `in '${name}'(ch ${ch}${mon})`;
}

// track id -> the [name, module] of the input feeding it; first one wins, and validate() complains about a second.
function inputsByTrack(g: GraphDoc): Map<string, [string, Module]> {
  const m = new Map<string, [string, Module]>();
  for (const c of Object.values(g.chains)) {
    if (!c.from || m.has(c.from)) continue;
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      m.set(c.from, [s.module, b]);
      break;
    }
  }
  return m;
}

// A chain's steps as "module -> module(bypassed) -> …", minus the io "in" step inputDesc already drew as the source.
function stepsDesc(g: GraphDoc, c: Chain): string {
  return c.use
    .filter((s) => !isInputModule(g, g.modules[s.module] ?? ({} as Module)))
    .map((s) => `${s.module}${s.enabled === false ? "(bypassed)" : ""}`)
    .join(" -> ");
}

// A gain suffix shown only when the signal is attenuated ("@30%"); the full-signal case stays bare.
const gainTag = (gain: number): string =>
  gain === 1 ? "" : `@${Math.round(gain * 100)}%`;

function downstream(g: GraphDoc, out: Out[], seen: Set<string>): string {
  if (!out.length) return "";
  const parts = out.map((o) => {
    const tag = gainTag(o.gain);
    const { node, port } = splitPort(o.to);
    if (isSink(g, node)) return o.to + tag; // e.g. OUT
    if (seen.has(node)) return `${o.to}${tag}(cycle)`;
    // A port destination lands mid-run, so it is traced from the chain HOSTING that step and named by the jack.
    const next = chainAt(g, o.to);
    const c = next ? g.chains[next] : undefined;
    if (!c) return `${o.to}${tag}(?)`;
    const head = port ? o.to : stepsDesc(g, c) || node;
    return `${head + tag}${downstream(g, c.out, new Set([...seen, node]))}`;
  });
  return ` -> ${parts.join(" + ")}`;
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

// --- CLI ---------------------------------------------------------------------

function main(): void {
  // Positionals: <project> [trackname]; a trackname narrows the display to that track's chains.
  const [projectArg, trackArg] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-"));
  if (!projectArg) {
    console.error("usage: st0 graph <project> [trackname]");
    process.exit(2);
  }
  let g: GraphDoc;
  try {
    g = loadGraph(resolve(projectArg));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(
    `${g.project.name}  (${g.project.tempo} bpm, ${g.project.timeSignature})`,
  );
  console.log(
    `  ${Object.keys(g.chains).length} chains · ${Object.keys(g.tracks).length} tracks · ` +
      `${Object.keys(g.modules).length} modules`,
  );
  console.log("");

  if (trackArg) {
    const id = resolveTrack(g, trackArg);
    if (!id) {
      console.error(
        `  no track matching '${trackArg}' (tracks: ${Object.keys(g.tracks).join(", ") || "none"})`,
      );
      process.exit(1);
    }
    console.log(`  chains for track '${id}':`);
    for (const line of describeTrackGraph(g, id)) console.log("  " + line);
  } else {
    for (const line of describeGraph(g)) console.log("  " + line);
  }

  if (g.warnings.length) {
    console.log("");
    console.warn(`  ${g.warnings.length} warning(s):`);
    for (const w of g.warnings) console.warn(`    ! ${w}`);
  }
}

// Run main() only when this FILE is the entry point; the url test alone isn't enough under a bundler (docs/graphModel.md).
if (
  process.argv[1] &&
  import.meta.url.endsWith("/graph.ts") &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
